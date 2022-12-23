const express = require('express');
const router = new express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const request = require('request');
var CryptoJS = require('crypto-js');
const fs = require('fs');
const bodyParser = require('body-parser');
const Sequelize = require('sequelize');
const { mySQLDump, postgresDump, postgresDumpSsl } = require('../utility/dumpDB.js');
const { encrypt } = require('../utility/encrypt');
const path = require('path');
var spawn = require('child_process').spawn;
const mysqldump = require('mysqldump');
const { execute } = require('@getvim/execute');

const auth = require('../authentication/authorization');
const validateLinkedinToken = require('../authentication/validateLinkedinToken');
const validator = require('../middlewares/validators/middleware');
const schema = require('../middlewares/validators/projects');
const { sendMail } = require('../services/mailing');
const { sendEmail } = require('../services/mailing');
const { capitalizeFirstLetter, removeDuplicateItems } = require('../utility/utilities');
const Projects = require('../models/projects');
const User = require('../models/user');
const Resources = require('../models/resources');
const OperationData = require('../models/operationData');
const TableRelationFilters = require('../models/tableRelationFilters');
const Tables = require('../models/tables');
const SchemaData = require('../models/schemas');
const Products = require('../models/products');
const Matcher = require('../models/matchers');
const UserSelMatches = require('../models/userOvrrdMatches');
const errorMessages = require('../utility/errorMessages');
const { getFormattedUtcDateTime } = require('../utility/utilities');
const testDBConnection = require('../controllers/testDBConnection');
const findAttributeTableDetails = require('../utility/findAttributeTableDetails');

const dataGenerationUrl = process.env.DATA_GENERATION_URL;
const aiServerURL = process.env.AI_SERVER_URL;
const uploadsDirectory = process.env.FILE_UPLOAD_PATH;
const shardInbxEmailId = process.env.SHAREDINBOX_EMAILID;
const codegenApiURL = process.env.CODE_GEN_SERVER_URL;
let hostPath = aiServerURL.replace(':5000', '');
if (hostPath.includes('instance-1')) {
	hostPath = hostPath.replace('instance-1', 'www');
}
hostPath = hostPath.replace('http', 'https');

router.get('/project', auth, async (req, res) => {
	let query = {
		$and: [
			{ $or: [{ author: req.user_id }, { 'members.email': req.user.email }] },
			{ isDeleted: false }
		]
	};

	const projects = await Projects.find(query).sort({ updatedAt: -1 });

	let nProjectsArr = [];
	let userDataMap = {}; // memorize records for user -> userData map

	for (projectItem of projects) {
		let nProjectObj = await getProjectsWithUserData(projectItem, userDataMap);
		nProjectsArr.push(nProjectObj);
	}

	res.status(200).send(nProjectsArr);
});

router.get('/project/:id', auth, async (req, res) => {
	try {
		const projectId = req.params.id;
		const query = { $and: [{ projectId: projectId }, { isDeleted: false }] };
		const project = await Projects.findOne(query);
		if (!project) {
			return res.status(404).send({ error: errorMessages.PROJECT_NOT_FOUND });
		}

		// Populate members data
		let nProjectObj = await getProjectsWithUserData(project);

		res.status(200).send(nProjectObj);
	} catch (error) {
		res.status(400).send({ error: error.message });
	}
});

router.post('/project', auth, validator(schema.projectsSchema), async (req, res) => {
	const author = req.user.user_id;
	const projectId = uuidv4();
	const isDefaultSpecDb = req.body.isDefaultClaimSpec || req.body.isDefaultAdvSpec;
	const project = new Projects({ ...req.body, author, projectId, isDefaultSpecDb });

	try {
		const invites = req.body.invites;
		const projectName = req.body.projectName;
		const authorName =
			capitalizeFirstLetter(req.user.firstName) +
			' ' +
			capitalizeFirstLetter(req.user.lastName);
		const authorEmail = req.user.email;
		let members = [];

		const user = await User.findOne({ user_id: req.user_id });
		let superuserFlag = user.is_superuser ? user.is_superuser : false;
		let product;
		let spec_parser;

		if (user.allowedProjects > 0 || superuserFlag || project.isDefaultSpecDb) {
			// Adding guest members to project
			let emailsArray = invites ? invites.map((item) => item.email) : [];

			// Remove duplicates frome emails array
			// And avoid adding admin as guest member
			emailsArray = removeDuplicateItems(emailsArray);
			emailsArray = emailsArray.filter((item) => item !== authorEmail);

			// Validatation: dont allow adding more than #membersLimit collabrators
			let membersCount = 0;
			let inviteCount = emailsArray.length;

			let subscribedPlan = user.subscribed_plan;

			let guestLimit;
			//Setting Guest Limit:
			let product1 = await Products.findOne({ plan_name: 'Trial' });
			if (product1) {
				guestLimit = product1.no_of_collaborators;
			}

			//if user has subscribed then update the guestlimit:
			product1 = await Products.findOne({ stripe_product_id: subscribedPlan });
			if (product1) {
				guestLimit = product1.no_of_collaborators;
			}

			//Checking Collaborator limit:
			if (!superuserFlag) {
				if (membersCount + inviteCount > guestLimit) {
					return res.status(400).send({
						errorType: 'COLLABRATOR_LIMIT_REACHED',
						message: errorMessages.COLLABRATOR_LIMIT_REACHED
					});
				}
			}

			for (email of emailsArray) {
				let invitedData = await sendInvite(email, projectName, authorName);
				members.push(invitedData);
			}

			//Setting Publish Limit:
			let product2 = await Products.findOne({ plan_name: 'Trial' });
			if (product2) {
				project.publishLimit = product2.no_of_republish + 1;
			}

			//if user has subscribed then update the publishlimit:
			product2 = await Products.findOne({ stripe_product_id: subscribedPlan });
			if (product2) {
				project.publishLimit = product2.no_of_republish + 1;
			}

			let product3;
			//making new user as trial user:
			if (!subscribedPlan) {
				if (!superuserFlag) {
					let register_Date = new Date(user.registeredOn);
					let current_Date = new Date(getFormattedUtcDateTime());
					const diffTime = current_Date - register_Date;
					const diffDays = diffTime / (1000 * 60 * 60 * 24);
					if (diffDays > 30) {
						return res.status(400).send({
							errorType: 'TRIAL_PERIOD_EXPIRED',
							message: errorMessages.TRIAL_PERIOD_EXPIRED
						});
					}
				}

				product3 = await Products.findOne({ plan_name: 'Trial' });
			} else {
				product3 = await Products.findOne({ stripe_product_id: subscribedPlan });
			}

			if (!product3) {
				return res.status(400).json({ message: 'Invalid subscribed product' });
			}

			let planName;
			if (product3) {
				planName = product3.plan_name;
			}
			if (planName == 'Basic') {
				project.projectBillingPlan = 'BASIC';
				await project.save();
			} else if (planName == 'Pro') {
				project.projectBillingPlan = 'PRO';
				await project.save();
			} else if (planName == 'POC') {
				project.projectBillingPlan = 'POC';
				await project.save();
			} else {
				project.projectBillingPlan = 'TRIAL';
				await project.save();
			}
			//if (!req.body.isDesign) {
			//	spec_parser = callSpecParserApi(projectId);
			//}
			// Add author as admin member
			let author = {
				accepted: true,
				email: req.user.email,
				user: req.user.user_id,
				role: 'admin'
			};

			members.push(author);

			// Geting products pricing version active while project is created
			let pricingVersions = [];
			const products = await Products.find({ isActive: 1 });
			if (products) {
				pricingVersions = products.map((productItem) => {
					let data = {
						productName: productItem.name,
						productVersion: productItem.version
					};
					return data;
				});
			}

			project.members = members;
			project.pricingVersions = pricingVersions;
			await project.save();
		}
		//SET initializeFlag to true to reset allowed projects:
		// user.initializeFlag = true;
		// await user.save();
		if (user.initializeFlag) {
			product = await Products.findOne({ plan_name: 'Trial' });
			user.allowedProjects = product.no_of_projects;
			await user.save();

			let subscribedPlan = user.subscribed_plan;
			product = await Products.findOne({ stripe_product_id: subscribedPlan });

			//Setting allowed projects limit:
			if (product) {
				user.allowedProjects = product.no_of_projects;
				await user.save();
			}
		}
		if (isDefaultSpecDb) {
			let currentSampleProjCnt = 0;
			if (user.sampleProjCount) {
				currentSampleProjCnt = user.sampleProjCount;
			}
			user.sampleProjCount = currentSampleProjCnt + 1;
			await user.save();
		}
		if (user.allowedProjects <= 0 && !superuserFlag && !project.isDefaultSpecDb) {
			let errType = 'ALLOWED_PROJECTS_LIMIT_EXHAUSTED';
			let msg = errorMessages.ALLOWED_PROJECTS_LIMIT_EXHAUSTED;
			if (!user.subscribed_plan) {
				errType = 'PROJECTS_LIMIT_EXHAUSTED';
				msg = errorMessages.FREE_PROJECTS_EXHAUSTED;
			}
			return res.status(400).send({
				errorType: errType,
				message: msg
			});
		} else {
			//user.allowedProjects = user.allowedProjects - 1;
			//user.initializeFlag = false;
			//await user.save();
			res.status(201).send(project);
			//res.status(201).json({ project });
		}
	} catch (error) {
		console.log({ error });
		res.status(400).send({ error: error.message });
	}
});

router.post('/db_to_python', async (req, res) => {
	const {
		projectId,
		sslMode,
		server,
		username,
		database,
		dbtype,
		portNo,
		certPath,
		keyPath,
		rootPath
	} = req.body;

	const query = { $and: [{ projectId: projectId }, { isDeleted: false }] };
	const project = await Projects.findOne(query);
	let type = 'db';
	if (type == 'db') {
		if (!project.projectType) {
			project.projectType = 'db';
		} else {
			project.projectType = 'both';
		}
	} else if (type == 'apiSpec') {
		if (!project.projectType) {
			project.projectType = 'schema';
		} else {
			project.projectType = 'both';
		}
	}
	project.isConnectDB = true;
	project.datagen_count = 0;
	project.datagen_perf_count = 0;
	await project.save();

	let { password } = req.body;

	var bytes = CryptoJS.AES.decrypt(password, process.env.AES_ENCRYPTION_KEY);
	password = bytes.toString(CryptoJS.enc.Utf8);

	let typeOfdb = dbtype;

	let url = aiServerURL + '/db_extractor';

	if (dbtype == 'mongo') {
		url = aiServerURL + '/mongo_extractor'
	}

	if (password) {
		var passwordToEncrypt = 'ezapidbpwdhandshake';
		encrypt(password, passwordToEncrypt, function (encoded) {
			password = encoded;
		});
	} else {
		password = '';
	}

	return new Promise((resolve, reject) => {
		let reqBody = {
			projectid: projectId,
			server: server,
			username: username,
			password: password,
			portNo: portNo,
			database: database,
			dbtype: dbtype,
			sslMode: sslMode,
			certPath: certPath,
			keyPath: keyPath,
			rootPath: rootPath
		};

		let options = {
			url: url,
			body: reqBody,
			json: true
		};

		request.post(options, async function (err, httpResponse, body) {
			if (err) {
				//console.log({ endpoint, err });
				resolve({
					success: false,
					message: 'Error occured while calling API'
				});
			} else {
				const { isDesign } = project;
				//console.log("isDesign: ", isDesign);
				let dbDetails;
				if (!isDesign) {
					callSpecParserApi(projectId);
				}
				delete reqBody.password;
				delete reqBody.projectid;
				dbDetails = reqBody;
				project.dbDetails = dbDetails;
				await project.save();
				resolve(body);
				res.status(httpResponse.statusCode).send({ body, projectId: projectId });
			}
		});
	});
});

router.delete('/project/:id', auth, async (req, res) => {
	const query = { projectId: req.params.id, author: req.user.user_id };
	const project = await Projects.findOne(query);
	if (!project) {
		return res.status(404).send({ error: errorMessages.PROJECT_NOT_FOUND });
	}
	var resourcesIds = [];
	var operationIds = [];
	var resources = project.resources;
	for (item of resources) {
		resourcesIds.push(item.resource);
	}
	for (resourceId of resourcesIds) {
		const resource = await Resources.findOne({ resourceId: resourceId });
		const paths = resource.path;

		for (let path of paths) {
			var operations = path.operations;
			for (operation of operations) {
				if (operation.operationId != null) {
					operationIds.push(operation.operationId);
				}
			}
		}
	}

	await Resources.deleteMany({ resourceId: { $in: resourcesIds } });
	console.log('Resources deleted');

	await OperationData.deleteMany({ id: { $in: operationIds } });
	console.log('OperationData records deleted');

	project.resources = [];

	project.isDeleted = true;
	await project.save();
	return res.status(200).send({ message: 'Deleted', project });
});

const attachProject = async (req, res, next) => {
	const projectId = req.params.id;
	const project = await Projects.findOne({ projectId });
	if (!project) {
		return res.status(404).send({ error: errorMessages.PROJECT_NOT_FOUND });
	} else {
		req.project = project;
		next();
	}
};

router.patch('/project/:id/update', auth, validator(schema.projectsUpdateReq), async (req, res) => {
	try {
		const authorEmail = req.user.email;
		const userId = req.user.user_id;
		const projectId = req.params.id;
		const query = { author: userId, isDeleted: false, projectId };
		const project = await Projects.findOne(query);
		if (!project) {
			return res.status(404).send({ error: errorMessages.PROJECT_NOT_FOUND });
		}

		const projectName = project.projectName;
		const authorName =
			capitalizeFirstLetter(req.user.firstName) +
			' ' +
			capitalizeFirstLetter(req.user.lastName);
		const updates = Object.keys(req.body);

		for (item of updates) {
			if (item == 'invites') {
				let emailsArray = req.body['invites'];

				// Remove duplicates frome emails array
				// And avoid adding admin as guest member
				emailsArray = removeDuplicateItems(emailsArray);
				emailsArray = emailsArray.filter((item) => item !== authorEmail);

				// Validatation: dont allow adding more than #membersLimit collabrators
				let membersCount = project.members.length;
				let inviteCount = emailsArray.length;
				let membersLimit = project.membersLimit;
				if (membersCount + inviteCount > membersLimit) {
					return res.status(400).send({
						errorType: 'COLLABRATOR_LIMIT_REACHED',
						error: errorMessages.COLLABRATOR_LIMIT_REACHED
					});
				}

				// Add guest
				for (email of emailsArray) {
					const isAlreadyInvited = project.members.some(function (el) {
						return el.email === email;
					});

					if (!isAlreadyInvited) {
						let invitedData = await sendInvite(email, projectName, authorName);
						project.members = [...project.invites, invitedData];
					}
				}
			} else if (item == 'removeInvites') {
				let emailsArray = req.body['removeInvites'];
				let removalCount = 0;

				// Remove duplicates from emails array
				emailsArray = removeDuplicateItems(emailsArray);
				// And avoid removing admin member
				emailsArray = emailsArray.filter((item) => item !== authorEmail);

				project.members = project.members.filter((item) => {
					let exists = emailsArray.includes(item.email);
					if (exists) {
						removalCount = removalCount + 1;
					} else return !exists;
				});
				project.membersLimit = project.membersLimit - removalCount;
			} else {
				project[item] = req.body[item];
			}
		}

		await project.save();
		res.send({ message: 'update sucessful!', project });
	} catch (error) {
		res.status(400).send({ error: error.message });
	}
});

router.post('/invite_collabrator', auth, validator(schema.invitaionRequest), inviteConroller);

router.post('/projects/:id/uploads', attachProject, uploadController);

router.post('/publish', auth, publishController);

/*
router.post('/publish', auth, async (req, res) => {
	try {
		let { projectId, password } = req.body;
		var bytes = CryptoJS.AES.decrypt(password, process.env.AES_ENCRYPTION_KEY);
		password = bytes.toString(CryptoJS.enc.Utf8);
		let query = {
			$and: [{ projectId }, { author: req.user_id }, { isDeleted: false }]
		};
		const project = await Projects.findOne(query);
		if (!project) {
			return res.status(404).send({ error: errorMessages.PROJECT_NOT_FOUND });
		}
		const dbDetails = project.dbDetails || {};
		const user = await User.findOne({ user_id: req.user_id });
		let superuserFlag = user.is_superuser ? user.is_superuser : false;

		// Validate project can be published
		const currPublishCount = project.publishCount;
		const projectBillingPlan = project.projectBillingPlan;
		let publishLeft = project.publishLimit - project.publishCount;
		let subscribedPlan = user.subscribed_plan;

		//checking for trial user:
		if (!subscribedPlan) {
			if (!superuserFlag) {
				let register_Date = new Date(user.registeredOn);
				let current_Date = new Date(getFormattedUtcDateTime());
				const diffTime = current_Date - register_Date;
				const diffDays = diffTime / (1000 * 60 * 60 * 24);
				if (diffDays > 30) {
					return res.status(400).send({
						errorType: 'TRIAL_PERIOD_EXPIRED',
						message: errorMessages.TRIAL_PERIOD_EXPIRED
					});
				}
			}
		}

		// if (
		// 	projectBillingPlan === 'TRIAL' ||
		// 	projectBillingPlan === 'BASIC' ||
		// 	projectBillingPlan === 'PRO'
		// ) {
		if (publishLeft <= 0 && !superuserFlag) {
			return res.status(400).send({
				errorType: 'PUBLISH_LIMIT_REACHED',
				message: errorMessages.PUBLISH_LIMIT_REACHED
			});
		}
		//} else

		// if (user.allowedProjects <= 0 && !superuserFlag) {
		// 	return res.status(400).send({
		// 		errorType: 'PROJECTS_LIMIT_EXHAUSTED',
		// 		message: errorMessages.FREE_PROJECTS_EXHAUSTED
		// 	});
		// }
		//  else {
		// 	user.allowedProjects = user.allowedProjects - 1;
		// 	await user.save();
		// 	// user has free trails left, Make project plan as FREE
		// 	//project.projectBillingPlan = 'TRIAL';
		// }

		// Reset all flags to default

		//Check for UnamppedFields in schema & db Flow only
		if (project.projectType == 'both') {
			const unmappedFields = await checkUnmappedFields(projectId);
			if (unmappedFields) {
				if (unmappedFields.error) {
					return res.status(500).send(unmappedFields);
				}
				return res.status(400).send({ message: errorMessages.UNMAPPED_FIELDS });
			}								 
		}
		project.codegen = false;
		project.dotnetcodegen = false;
		project.status = 'IN_PROGRESS';
		project.publishStatus = {
			ArtefactGeneration: { success: false, message: '' },
			SankyGeneration: { success: false, message: '' },
			SpecGeneration: { success: false, message: '' },
			dataGeneration: { success: false, message: '' }
		};
		await project.save();

		//Call codegen api & gendotnet api w/o awaiting for response
		callCodegenApi(projectId);
		callGenDotNetCodeApi({ projectid: projectId, password, ...dbDetails });

		//Call Spec gen, sankey, artefact  & data gen apis
		let apiEndpoints = ['spec_generator', 'sankey', 'artefacts', 'generate'];
		let apiResp;
		//if (project.isConnectDB && !project.publishCount) {
		if (user.allowedProjects <= 0 && currPublishCount === 0 && !project.isDefaultSpecDb) {
			return res.status(400).send({
				errorType: 'ALLOWED_PROJECTS_LIMIT_EXHAUSTED',
				message: errorMessages.ALLOWED_PROJECTS_LIMIT_EXHAUSTED
			});
		}
		if (project.isConnectDB) {
			apiResp = await Promise.all([
				callGeneratorApi(projectId, apiEndpoints[0]),
				callGeneratorApi(projectId, apiEndpoints[1]),
				callGeneratorApi(projectId, apiEndpoints[2]),
				callGeneratorApi(projectId, apiEndpoints[3])
			]);
		} else {
			apiResp = await Promise.all([
				callGeneratorApi(projectId, apiEndpoints[0]),
				callGeneratorApi(projectId, apiEndpoints[1]),
				callGeneratorApi(projectId, apiEndpoints[2])
			]);
		}
		let genApiResp = {
			SpecGeneration: apiResp[0],
			SankyGeneration: apiResp[1],
			ArtefactGeneration: apiResp[2],
			DataGeneration: apiResp[3] ? apiResp[3] : null
		};

		// Parse resp and get success status of gen APIs, for updating Project's publish status
		let publishStatus = {
			SpecGeneration: getGeneratorStatus(apiResp[0]),
			SankyGeneration: getGeneratorStatus(apiResp[1]),
			ArtefactGeneration: getGeneratorStatus(apiResp[2]),
			DataGeneration: apiResp[3] ? getGeneratorStatus(apiResp[3]) : null
		};

		// if spec generation is success or ( artifact generation + sankey generation) is success, project status is complete
		let successStatus;
		let message = '';
		if (
			publishStatus.SpecGeneration.success &&
			publishStatus.SankyGeneration.success &&
			publishStatus.ArtefactGeneration.success
		) {
			project.status = 'COMPLETE';
			successStatus = true;

			//maintain publish count
			project.publishCount = project.publishCount + 1;
			if (currPublishCount === 0 && !project.isDefaultSpecDb) {
				user.allowedProjects = user.allowedProjects - 1;
				user.initializeFlag = false;
				await user.save();

				console.log('allowed projects after', user.allowedProjects);
			}
		} else if (publishStatus.SpecGeneration.success) {
			successStatus = false;
			message = errorMessages.SPEC_GENERATED_ARTIFACT_ERROR;
		} else if (!publishStatus.DataGeneration.success) {
			successStatus = false;
			message = errorMessages.DATA_GENERATED_ERROR;
		} else {
			successStatus = false;
			message = errorMessages.SPEC_ARTIFACT_GEN_ERROR;
		}

		// Save project status and publish status
		project.publishStatus = publishStatus;
		await project.save();

		let result = {
			success: successStatus,
			message: message,
			generatorApiResp: genApiResp
		};

		res.status(200).send(result);
	} catch (error) {
		res.status(400).send({ error: error.message });
	}
});
*/


let clients = [];
router.get('/sse', auth, (req, res) => {
	const projectId = null;
	const enableIcon = false;
	res.write('event: dataGenCompleted\n');
	res.write(`data: {projectId:${projectId},enableIcon:${enableIcon}}`);
	res.write('\n\n');
	clients.push({ userId: req.user.user_id, res });
	req.on('close', () => {
		clients = clients.filter((client) => client.userId !== req.user.user_id);
	});
});

router.post('/data_gen_status', async (req, res) => {
	const { projectId, enableIcon } = req.body;
	const project = await Projects.findOne({ projectId });
	if (project) {
		res.status(200).json({ message: 'Success' });
		return sendEventsToClients({ projectId, enableIcon });
	} else {
		res.status(400).json({ message: 'Invalid projectId or project does not exist' });
	}
});


router.post('/getTablesRelations', auth, async (req, res) => {
	const { projectId } = req.body;
	const { projectType } = await Projects.findOne({ projectId }, { projectType: 1 }).lean();
	if (!(projectType == 'db')) {
		return res.status(400).send('Table Relations applicable only for db only flow');
	}
	const tableRelationsList = await TableRelationFilters.find(
		{ projectid: projectId },
		{ 'relations._id': 0, 'filters._id': 0 }
	).lean();
	let tablesList;
	let relationsData;
	let filtersData;
	if (tableRelationsList && tableRelationsList.length) {
		relationsData = tableRelationsList.filter((record) => record.relationType == 'relations');
		filtersData = tableRelationsList.filter((record) => record.relationType == 'filters');
		if (relationsData) {
			const { operationDataTables } = relationsData[0];
			let tablesListData = await getTablesList(projectId);
			tablesList = tablesListData.tablesList;
			tablesKeysList = Object.keys(tablesList);
			const isEqual = await areEqual(operationDataTables, tablesKeysList);
			if (isEqual) {
				return res.status(200).send({
					projectid: projectId,
					relations:
						relationsData && relationsData.length ? relationsData[0].relations : [],
					filters: filtersData && filtersData.length ? filtersData[0].filters : []
				});
			}
			await TableRelationFilters.updateOne(
				{
					projectid: projectId,
					relationType: 'relations'
				},
				{
					$pull: { relations: { origin: 'derived' } }
				}
			);
		}
	}
	if (!tablesList) {
		let tablesListData = await getTablesList(projectId);
		tablesList = tablesListData.tablesList;
	}
	const { tableRelationsList: tableRelations, tablesListArray: operationDataTables } =
		await getTableRelations(tablesList, projectId);
	if (relationsData) {
		await TableRelationFilters.updateOne(
			{
				projectid: projectId,
				relationType: 'relations'
			},
			{
				$push: {
					relations: {
						$each: tableRelations
					}
				},
				operationDataTables: Object.keys(tablesList)
			}
		);
	} else {
		if (tableRelations && tableRelations.length) {
			const newTableRelation = new TableRelationFilters({
				projectid: projectId,
				relationType: 'relations',
				relations: tableRelations,
				operationDataTables: Object.keys(tablesList)
			});
			await newTableRelation.save();
		}
	}
	relationsData =
		relationsData &&
		relationsData.length &&
		relationsData[0].relations &&
		relationsData[0].relations.length
			? relationsData[0].relations.filter((rel) => rel.origin == 'userInput')
			: [];
	if (relationsData && relationsData.length) {
		tableRelations.push(...relationsData);
	}
	const filters =
		filtersData && filtersData.length && filtersData[0].filters && filtersData[0].filters.length
			? filtersData[0].filters
			: [];
	return res.status(200).json({
		projectid: projectId,
		relations: tableRelations || [],
		filters
	});
});
router.post('/getOperationDataTables', async (req, res) => {
	const { projectId } = req.body;
	const { projectType } = await Projects.findOne({ projectId }, { projectType: 1 }).lean();
	if (!(projectType == 'db')) {
		return res.status(400).send('Operation Data tables applicable only for db only flow');
	}
	const { tableRelations } = await getTablesList(projectId, true);
	if (tableRelations) {
		return res.status(200).send(tableRelations);
	}
	return res.status(400).json({ message: 'No tables or no operationData' });
});

router.post('/tableMappings', auth, async (req, res) => {
	try {
		const { projectId, relations, filters } = req.body;
		if (!projectId) {
			return res.status(400).send('projectId is missing');
		}
		const { projectType } = await Projects.findOne({ projectId }, { projectType: 1 }).lean();
		if (!(projectType == 'db')) {
			return res.status(400).send('Operation Data tables applicable only for db only flow');
		}
		if (relations && relations.length) {
			await TableRelationFilters.updateOne(
				{
					projectid: projectId,
					relationType: 'relations'
				},
				{
					$set: { relations }
				},
				{
					upsert: true
				}
			);
		}
		if (filters && filters.length) {
			await TableRelationFilters.updateOne(
				{
					projectid: projectId,
					relationType: 'filters'
				},
				{
					$set: { filters }
				},
				{
					upsert: true
				}
			);
		}

		const newTableRelationsList = await TableRelationFilters.findOne({
			projectid: projectId,
			relationType: 'relations',
			'relations.origin': 'userInput'
		}).lean();
		let usrInputRelations;
		if (newTableRelationsList) {
			usrInputRelations = newTableRelationsList.relations.filter(
				(rec) => rec.origin == 'userInput'
			);
		}
		if (usrInputRelations && usrInputRelations.length) {
			for (const usrInputRltn of usrInputRelations) {
				const {
					mainTable,
					mainTableSchema,
					mainTableColumn,
					dependentTable,
					dependentTableColumn,
					dependentTableSchema
				} = usrInputRltn;
				await Tables.updateOne(
					{
						projectid: projectId,
						key: mainTableSchema + '.' + mainTable,
						'attributes.name': mainTableColumn
					},
					{
						$set: {
							'attributes.$.logicalKey': {
								key: 'customKey',
								schema: dependentTableSchema,
								table: dependentTable,
								column: dependentTableColumn
							}
						}
					}
				);
			}   
		}
		//await publishController(req, res);
		return res.status(200).send({ message: 'Entity mappings saved successfully' });
	} catch (err) {
		return res.status(400).send({ err: err.message });
	}
});


const sendEventsToClients = async (responseData) => {
	const { projectId } = responseData;
	const project = await Projects.findOne({ projectId });
	let authorId;
	if (project) {
		authorId = project.author;
	}
	clients.every((client) => {
		if (client.userId === authorId) {
			client.res.write(`event: dataGenCompleted\n`);
			client.res.write(`data: ${JSON.stringify(responseData)}\n\n`);
			return false;
		}
	});
};
const storage = multer.diskStorage({
	destination: function (req, file, cb) {
		cb(null, uploadsDirectory);
	}
});

async function uploadController(req, res) {
	//this request may take around 10 mins to complete
	let timeout = 10 * 60 * 1000;
	req.socket.setTimeout(timeout);
	const project = req.project;

	try {
		let upload = multer({
			storage: storage,
			limits: { fileSize: 52428800, fieldSize: 52428800 } // 52428800
		}).array('upload');

		upload(req, res, async function (err) {
			//try {
			if (err) {
				console.log(err);
				await removeProject(project);
				res.status(400).send({ error: 'Error uploading file.' });
				req.socket.destroy();
				return;
			} else {
				// validate file upload request
				const { error } = schema.schemaUploadReq.validate(req.body);
				const valid = error == null;
				if (!valid) {
					const { details } = error;
					const message = details.map((i) => i.message).join(',');
					await removeProject(project);
					res.status(400).send(error);
					req.socket.destroy();
					return;
				}

				//extracting file data in appropriate form
				const filesList = req.files.map((item) => {
					return {
						name: item.originalname,
						file: item.filename
					};
				});

				let resp;
				const type = req.body.type;
				const dbtype = req.body.dbtype;

				let projectId = req.params.id;

				if (type == 'apiSpec') {
					project.apiSpec = filesList;
				} else if (type == 'db') {
					project.dbSchema = filesList;
				}

				await project.save();
				let projectObj = project;

				if (type == 'db') {
					let len = projectObj.dbSchema.length;
					if (len == 0) {
						throw new Error('No DB file found for this project');
					}

					let file = projectObj.dbSchema[len - 1]['file']; // taking the last uploaded db file, because nultiple file parsing is not supported currently
					let fileName = projectObj.dbSchema[len - 1]['name'];
					let url = aiServerURL + '/ddl_parser';

					try {
						resp = await uploadFileToAiServer({
							url,
							file,
							fileName,
							type,
							dbtype,
							projectId
						});
					} catch (e) {
						await removeProject(project);
						res.status(400).send(e);
						req.socket.destroy();
						return;
					}
				} else if (type == 'apiSpec') {
					let len = projectObj.apiSpec.length;
					if (len == 0) {
						throw new Error('No Spec file found for this project');
					}

					let file = projectObj.apiSpec[len - 1]['file']; // taking the last uploaded spec file
					let fileName = projectObj.apiSpec[len - 1]['name'];
					let url = aiServerURL + '/spec_parser';

					try {
						resp = await uploadFileToAiServer({
							url,
							file,
							fileName,
							type,
							dbtype,
							projectId
						});
					} catch (e) {
						await removeProject(project);
						res.status(400).send(e);
						req.socket.destroy();
						return;
					}
				}

				//Updating project status
				if (resp.status == 200) {
					project.status = 'IN_PROGRESS';
				} else {
					// Parsing error
					await removeProject(project);
					let error = {
						projectId: project.projectId,
						aiResponse: resp
					};
					res.status(400).send(error);
					req.socket.destroy();
					return;
				}
				if (type == 'db') {
					if (!project.projectType) {
						project.projectType = 'db';
					} else {
						project.projectType = 'both';
					}
				} else if (type == 'apiSpec') {
					if (!project.projectType) {
						project.projectType = 'schema';
					} else {
						project.projectType = 'both';
					}
				}
				await project.save();

				let statusCode = resp.status ? resp.status : 400;
				res.status(statusCode).send({
					projectId: project.projectId,
					aiResponse: resp
				});
				req.socket.destroy();
				return;
			}
			/* } catch (error) {
			await removeProject(project);
			res.status(400).send(error.message);
			req.socket.destroy();
			return;
		} */
		});
	} catch (error) {
		await removeProject(project);
		res.status(400).send(error.message);
		req.socket.destroy();
		return;
	}
}

async function removeProject(project) {
	try {
		console.log('Removing project');
		// Delete related files from file system if any
		let relatedFilesList = [];
		if (project.apiSpec.length > 0) {
			relatedFilesList = project.apiSpec;
		}

		if (project.dbSchema.length > 0) {
			relatedFilesList = [...relatedFilesList, ...project.dbSchema];
		}

		for (item of relatedFilesList) {
			let fileName = item.file;
			let filePath = uploadsDirectory + fileName;
			console.log('Removing dbSchema', filePath);
			fs.unlinkSync(filePath);
			console.log(`${filePath} successfully deleted from the local storage`);
		}

		const user = await User.findOne({ user_id: project.author });
		const allowedProjects = user.allowedProjects;
		//user.allowedProjects = allowedProjects + 1;

		await user.save();

		// Delete project
		await project.remove();
	} catch (err) {
		console.log(`Error deleting project`, err);
	}
}

async function inviteConroller(req, res) {
	try {
		//find user

		const userId = req.user_id;
		const user = await User.findOne({ user_id: req.user_id });
		const projectId = req.body.projectId;
		let emailsArray = req.body.emails;
		const authorEmail = req.user.email;
		let projectQuery = { author: userId, isDeleted: false, projectId: projectId };
		let usersQuery = { user_id: userId };
		const project = await Projects.findOne(projectQuery);
		const inviter = await User.findOne(usersQuery);

		if (!project) {
			return res.status(404).send({ error: errorMessages.PROJECT_NOT_FOUND });
		}

		if (!inviter) {
			return res.status(400).send({ error: errorMessages.USER_ID_NOT_VALID });
		}

		// Validatation: dont allow adding more than #membersLimit collabrators
		//let membersCount = project.members.length;
		let membersCount = project.membersLimit;
		let inviteCount = emailsArray.length;
		//let membersLimit = project.membersLimit;
		let product = await Products.findOne({ plan_name: 'Trial' });
		let membersLimit = product.no_of_collaborators;
		let superuserFlag = user.is_superuser ? user.is_superuser : false;

		let subscribedPlan = user.subscribed_plan;
		product = await Products.findOne({ stripe_product_id: subscribedPlan });

		if (product) {
			//Setting collaborators limit:
			membersLimit = product.no_of_collaborators;
		}

		if (!superuserFlag) {
			if (membersCount + inviteCount > membersLimit) {
				return res.status(400).send({
					errorType: 'COLLABRATOR_LIMIT_REACHED',
					message: errorMessages.COLLABRATOR_LIMIT_REACHED
				});
			}
		}

		const projectName = project.projectName;
		const authorName = inviter.firstName + inviter.lastName;
		for (email of emailsArray) {
			const isAlreadyInvited = project.members.some(function (el) {
				return el.email === email;
			});
			if (!isAlreadyInvited) {
				let invitedData = await sendInvite(email, projectName, authorName);
				project.members = [...project.members, invitedData];
				project.membersLimit = membersCount + inviteCount;
			}
		}
		await project.save();
		const projectObj = await getProjectsWithUserData(project);
		res.status(200).send({
			members: projectObj.members,
			membersLimit: membersCount + inviteCount
		});
	} catch (error) {
		res.status(400).send({ error: error.message });
	}
}

async function getProjectsWithUserData(project, userDataMap = {}) {
	let nProjectObj = project.toObject();

	for (inviteItem of nProjectObj.members) {
		let userD = userDataMap[inviteItem.user];
		if (!!userD) {
			inviteItem['user_data'] = userD;
		} else {
			let userf = await User.findOne({ user_id: inviteItem.user });
			if (userf) {
				userf = userf.getPublicProfile();

				userDataMap[inviteItem.user] = userf;
				inviteItem['user_data'] = userf;
			}
		}
	}
	return nProjectObj;
}

async function sendInvite(email, projectName = '', authorName = '') {
	let user = await User.findOne({ email });
	let invitedData = {};

	const mailOptions = {
		//from: `EZAPI <admin@ezapi.ai>`,
		from: shardInbxEmailId,
		to: email,
		subject: 'Invited for Collaboration',
		text: `Hi There!\n\nYou have been invited by ${authorName} to collaborate on ${projectName} project.\nRegister on https://www.conektto.io/ to collabrate.\n\nThanks.`
	};
	sendEmail(mailOptions);

	if (user) {
		invitedData = { email: email, user: user.user_id, accepted: true };
	} else {
		invitedData = { email: email };
	}

	return invitedData;
}

async function uploadFileToAiServer(params) {
	const { url, file, fileName, type, dbtype, projectId } = params;
	//console.log(params);
	//	console.log(host, username, password, port, database);
	// console.log('FILE UPLOAD STARTING...');
	let uploadField;
	if (type == 'db') {
		uploadField = 'ddl_file';
	} else if (type == 'apiSpec') {
		uploadField = 'spec_file';
	}

	//	console.log(uploadField);

	return new Promise(function (resolve, reject) {
		const callback = (error, httpResponse, body) => {
			let statusCode;
			if (httpResponse && httpResponse.statusCode) {
				statusCode = httpResponse.statusCode;
			}

			if (error) {
				console.log('Error!', error);
				resolve({ status: statusCode, message: 'Error', error: error });
			} else {
				//console.log('Response: ' + body);
				if (statusCode == '200') {
					body = JSON.parse(body);
					console.log('JSON Response: ' + body);
					resolve(body);
				} else {
					reject(body);
				}
			}
		};

		let req1 = request.post(url, callback);

		//	let filePath = path.join(__dirname, '../../uploads/' + file);
		let filePath = 'uploads/' + file;
		//		let fileData = fs.createReadStream(filePath);
		let fileData;

		async function read(inputFilePath) {
			fileData = fs.createReadStream(inputFilePath, {
				encoding: 'utf8',
				highWaterMark: 1024
			});

			for await (const chunk of fileData) {
				//console.log('>>> ' + chunk);
				//console.log('reading file data')
			}
			console.log('### DONE ###');
		}
		read(filePath);

		var form = req1.form();
		form.append(uploadField, fileData, {
			filename: fileName
		});
		form.append('dbtype', dbtype);
		form.append('projectid', projectId);
	});
}

function getGeneratorStatus(res) {
	result = {
		success: !!res && res.success == true ? res.success : false,
		message: !!res && res.message ? res.message : ''
	};
	return result;
}

function callGeneratorApi(projectId, endpoint) {
	return new Promise((resolve, reject) => {
		let url;
		let body;
		if (endpoint == 'generate') {
			url = dataGenerationUrl + '/' + endpoint;
			body = { projectid: projectId, type: 'functional', mode: 'online' };
		} else {
			url = aiServerURL + '/' + endpoint;
			body = { projectid: projectId };
		}
		let options = {
			url: url,
			body: body,
			json: true
		};
		request.post(options, async function (err, httpResponse, body) {
			if (err) {
				console.log({ endpoint, err });
				resolve({
					success: false,
					message: 'Error occured while calling API'
				});
			} else {
				console.log({ endpoint, body });
				resolve(body);
			}
		});
	});
}

function callCodegenApi(projectId) {
	try {
		let endpoint = 'codegen';
		let url = aiServerURL + '/' + endpoint;
		let options = {
			url: url,
			body: { projectid: projectId },
			json: true
		};

		request.post(options, async function (err, httpResponse, body) {
			if (err) {
				console.log({ endpoint, err });
			} else {
				console.log({ endpoint, body });
			}
		});
	} catch (error) {
		console.log(
			'Error while calling codegen for projectId: ',
			projectId,
			', Error: ',
			error.message
		);
	}
}

function callSpecParserApi(projectId) {
	try {
		let endpoint = 'raw_spec_parser';
		let url = aiServerURL + '/' + endpoint;
		let options = {
			url: url,
			body: { projectid: projectId },
			json: true
		};

		request.post(options, async function (err, httpResponse, body) {
			if (err) {
				return { SPEC_PARSER: 'Failure' };
			} else {
				const { statusCode } = httpResponse;
				if (statusCode != 200) {
					return { SPEC_PARSER: 'failure' };
				}
				return { SPEC_PARSER: 'success' };
			}
		});
	} catch (error) {
		console.log(
			'Error while calling spec-parser for projectId: ',
			projectId,
			', Error: ',
			error.message
		);
	}
}

async function checkUnmappedFields(projectId) {
	try {
		let operationData = await OperationData.find({ projectid: projectId }).lean();
		if (operationData.length) {
			for (const operation of operationData) {
				const { requestData, responseData } = operation.data;
				const { header, path, query, formData, body } = requestData;
				//for Request Data
				const requestDataList = [header, path, query, formData, body];
				for (const requestField of requestDataList) {
					if (requestField == body && requestField.properties) {
						let requestBodyProperties = Object.keys(requestField.properties);
						//loop through req body
						for (const bodyProperty of requestBodyProperties) {
							const bodyFieldObject = requestField.properties[bodyProperty];
							if (bodyFieldObject.ezapi_ref && bodyFieldObject.name) {
								const schemaData = await SchemaData.findOne({
									projectid: projectId,
									'data.name': bodyFieldObject.name
								}).lean();
								if (schemaData && schemaData.data && schemaData.data.attributes) {
									const attributes = schemaData.data.attributes;
									const schemaName = schemaData.data.name;
									for (const attribute of attributes) {
										let attributeName = attribute.name;
										const tableDetailsObject = await findAttributeTableDetails(
											projectId,
											schemaName,
											attributeName,
											operation
										);
										let result = Array.isArray(tableDetailsObject);
										if (!result) {
											if (tableDetailsObject.noMatch) {
												return true;
											}
										}
									}
								} else {
									return true;
								}
							} else {
								const schemaName = bodyFieldObject.schemaName;
								const attributeName = bodyFieldObject.name;
								const tableDetailsObject = await findAttributeTableDetails(
									projectId,
									schemaName,
									attributeName,
									operation
								);
								let result = Array.isArray(tableDetailsObject);
								if (!result) {
									if (tableDetailsObject.noMatch) {
										return true;
									}
								}
							}
						}
					} else {
						if (requestField && requestField.length) {
							//Loop through Other request Fields
							for (const property of requestField) {
								let propertyName = Object.keys(property).length
									? Object.keys(property)[0]
									: null;
								if (propertyName) {
									const { schemaName, name: attributeName } =
										property[propertyName];
									const tableDetailsObject = await findAttributeTableDetails(
										projectId,
										schemaName,
										attributeName,
										operation
									);
									let result = Array.isArray(tableDetailsObject);
									if (!result) {
										if (tableDetailsObject.noMatch) {
											return true;
										}
									}
								}
							}
						}
					}
				}
				//for Response Data
				if (responseData && responseData.length) {
					//loop through all statusCodes responses
					for (const response of responseData) {
						let responseHeaders = response.headers || null;
						//for EachStatusCode response header
						if (responseHeaders) {
							for (const header of responseHeaders) {
								let headerProperty = Object.keys(header)[0];
								const { schemaName, name: attributeName } = headerProperty;
								const tableDetailsObject = await findAttributeTableDetails(
									projectId,
									schemaName,
									attributeName,
									operation
								);
								let result = Array.isArray(tableDetailsObject);
								if (!result) {
									if (tableDetailsObject.noMatch) {
										return true;
									}
								}
							}
						}
						let responseBody = response.content;
						let responseBodyProperties;
						if (responseBody && responseBody.properties) {
							responseBodyProperties = Object.keys(responseBody.properties);
							for (const bodyProperty of responseBodyProperties) {
								const bodyFieldObject = responseBody.properties[bodyProperty];
								if (bodyFieldObject.ezapi_ref && bodyFieldObject.name) {
									const schemaData = await SchemaData.findOne({
										projectid: projectId,
										'data.name': bodyFieldObject.name
									}).lean();
									if (
										schemaData &&
										schemaData.data &&
										schemaData.data.attributes
									) {
										const attributes = schemaData.data.attributes;
										const schemaName = schemaData.data.name;
										for (const attribute of attributes) {
											let attributeName = attribute.name;
											const tableDetailsObject =
												await findAttributeTableDetails(
													projectId,
													schemaName,
													attributeName,
													operation
												);
											let result = Array.isArray(tableDetailsObject);
											if (!result) {
												if (tableDetailsObject.noMatch) {
													return true;
												}
											}
										}
									}
								} else {
									const schemaName = bodyFieldObject.schemaName;
									const attributeName = bodyFieldObject.name;
									const tableDetailsObject = await findAttributeTableDetails(
										projectId,
										schemaName,
										attributeName,
										operation
									);
									let result = Array.isArray(tableDetailsObject);
									if (!result) {
										if (tableDetailsObject.noMatch) {
											return true;
										}
									}
								}
							}
						}
					}
				}
			}
		}
		return false;
	} catch (err) {
		console.log('error', err.message);
		return { error: err.message };
	}
}


function callGenDotNetCodeApi(body) {
	try {
		let endpoint = 'genDotNetCodeFrmTemplates';
		let url = codegenApiURL + '/' + endpoint;
		let newbody = {
			projectid: body.projectid,
			DataUpload: 'Y',
			dbserver: body.server,
			dbname: body.database,
			username: body.username,
			password: body.password
		};
		let options = {
			url,
			body: newbody,
			json: true
		};

		request.post(options, async function (err, httpResponse, body) {
			if (err) {
				console.log({ endpoint, err });
			} else {
				console.log({ endpoint, body });
			}
		});
	} catch (error) {
		console.log(
			'Error while calling dotnetgen for projectId: ',
			projectId,
			', Error: ',
			error.message
		);
	}
}

async function publishController(req, res) {
	try {
		let { projectId, password } = req.body;
		if (password) {
			var bytes = CryptoJS.AES.decrypt(password, process.env.AES_ENCRYPTION_KEY);
			password = bytes.toString(CryptoJS.enc.Utf8);
		}
		let query = {
			$and: [{ projectId }, { author: req.user_id }, { isDeleted: false }]
		};
		const project = await Projects.findOne(query);
		if (!project) {
			return res.status(404).send({ error: errorMessages.PROJECT_NOT_FOUND });
		}
		const dbDetails = project.dbDetails || {};
		const user = await User.findOne({ user_id: req.user_id });
		let superuserFlag = user.is_superuser ? user.is_superuser : false;

		// Validate project can be published
		const currPublishCount = project.publishCount;
		const projectBillingPlan = project.projectBillingPlan;
		let publishLeft = project.publishLimit - project.publishCount;
		let subscribedPlan = user.subscribed_plan;

		//checking for trial user:
		if (!subscribedPlan) {
			if (!superuserFlag) {
				let register_Date = new Date(user.registeredOn);
				let current_Date = new Date(getFormattedUtcDateTime());
				const diffTime = current_Date - register_Date;
				const diffDays = diffTime / (1000 * 60 * 60 * 24);
				if (diffDays > 30) {
					return res.status(400).send({
						errorType: 'TRIAL_PERIOD_EXPIRED',
						message: errorMessages.TRIAL_PERIOD_EXPIRED
					});
				}
			}
		}

		if (publishLeft <= 0 && !superuserFlag) {
			return res.status(400).send({
				errorType: 'PUBLISH_LIMIT_REACHED',
				message: errorMessages.PUBLISH_LIMIT_REACHED
			});
		}
		//Check for UnamppedFields in schema & db Flow only
		if (project.projectType == 'both') {
			const unmappedFields = await checkUnmappedFields(projectId);
			if (unmappedFields) {
				if (unmappedFields.error) {
					return res.status(500).send(unmappedFields);
				}
				return res.status(400).send({ message: errorMessages.UNMAPPED_FIELDS });
			}
		}

		// Reset all flags to default
		project.codegen = false;
		project.dotnetcodegen = false;
		project.status = 'IN_PROGRESS';
		project.publishStatus = {
			ArtefactGeneration: { success: false, message: '' },
			SankyGeneration: { success: false, message: '' },
			SpecGeneration: { success: false, message: '' },
			dataGeneration: { success: false, message: '' }
		};
		await project.save();

		//Call codegen api & gendotnet api w/o awaiting for response
		callCodegenApi(projectId);
		callGenDotNetCodeApi({ projectid: projectId, password, ...dbDetails });

		//Call Spec gen, sankey, artefact  & data gen apis
		let apiEndpoints = ['spec_generator', 'sankey', 'artefacts', 'generate'];
		let apiResp;
		//if (project.isConnectDB && !project.publishCount) {
		if (user.allowedProjects <= 0 && currPublishCount === 0 && !project.isDefaultSpecDb) {
			return res.status(400).send({
				errorType: 'ALLOWED_PROJECTS_LIMIT_EXHAUSTED',
				message: errorMessages.ALLOWED_PROJECTS_LIMIT_EXHAUSTED
			});
		}
		if (project.isConnectDB) {
			apiResp = await Promise.all([
				callGeneratorApi(projectId, apiEndpoints[0]),
				callGeneratorApi(projectId, apiEndpoints[1]),
				callGeneratorApi(projectId, apiEndpoints[2]),
				callGeneratorApi(projectId, apiEndpoints[3])
			]);
		} else {
			apiResp = await Promise.all([
				callGeneratorApi(projectId, apiEndpoints[0]),
				callGeneratorApi(projectId, apiEndpoints[1]),
				callGeneratorApi(projectId, apiEndpoints[2])
			]);
		}
		let genApiResp = {
			SpecGeneration: apiResp[0],
			SankyGeneration: apiResp[1],
			ArtefactGeneration: apiResp[2],
			DataGeneration: apiResp[3] ? apiResp[3] : null
		};

		// Parse resp and get success status of gen APIs, for updating Project's publish status
		let publishStatus = {
			SpecGeneration: getGeneratorStatus(apiResp[0]),
			SankyGeneration: getGeneratorStatus(apiResp[1]),
			ArtefactGeneration: getGeneratorStatus(apiResp[2]),
			DataGeneration: apiResp[3] ? getGeneratorStatus(apiResp[3]) : null
		};

		// if spec generation is success or ( artifact generation + sankey generation) is success, project status is complete
		let successStatus;
		let message = '';
		if (
			publishStatus.SpecGeneration.success &&
			publishStatus.SankyGeneration.success &&
			publishStatus.ArtefactGeneration.success
		) {
			project.status = 'COMPLETE';
			successStatus = true;

			//maintain publish count
			project.publishCount = project.publishCount + 1;
			if (currPublishCount === 0 && !project.isDefaultSpecDb) {
				user.allowedProjects = user.allowedProjects - 1;
				user.initializeFlag = false;
				await user.save();

				console.log('allowed projects after', user.allowedProjects);
			}
		} else if (publishStatus.SpecGeneration.success) {
			successStatus = false;
			message = errorMessages.SPEC_GENERATED_ARTIFACT_ERROR;
		} else if (!publishStatus.DataGeneration.success) {
			successStatus = false;
			message = errorMessages.DATA_GENERATED_ERROR;
		} else {
			successStatus = false;
			message = errorMessages.SPEC_ARTIFACT_GEN_ERROR;
		}

		// Save project status and publish status
		project.publishStatus = publishStatus;
		await project.save();

		let result = {
			success: successStatus,
			message: message,
			generatorApiResp: genApiResp
		};

		return res.status(200).send(result);
	} catch (error) {
		return res.status(400).send({ error: error.message });
	}
}

async function getTablesList(projectid, relations = false) {
	try {
		let operationData = await OperationData.find({ projectid }).lean();
		let tablesList = {};
		let tableRelations = [];
		if (operationData && operationData.length) {
			for (const operation of operationData) {
				const { requestData, responseData } = operation.data;
				const { header, path, query, formData, body } = requestData;
				//for Request Data
				const requestDataList = [header, path, query, formData, body];
				for (const requestField of requestDataList) {
					if (requestField == body && (requestField.properties || requestField.name)) {
						let requestBodyProperties;
						if (requestField.properties) {
							requestBodyProperties = Object.keys(requestField.properties);
						} else {
							requestBodyProperties = [requestField];
						}
						//loop through req body
						for (const bodyProperty of requestBodyProperties) {
							let bodyFieldObject;
							if (requestField.properties) {
								bodyFieldObject = requestField.properties[bodyProperty];
							} else {
								bodyFieldObject = bodyProperty;
							}
							if (bodyFieldObject.type == 'arrayOfObjects') {
								const arrayKeys =
									bodyFieldObject.items && bodyFieldObject.items.properties
										? Object.keys(bodyFieldObject.items.properties)
										: [];
								for (const eachKey of arrayKeys) {
									const arrayItem = bodyFieldObject.items.properties[eachKey];

									if (
										(arrayItem.tableName || arrayItem.sourceName) &&
										tablesList[arrayItem.tableName || arrayItem.sourceName]
									) {
										continue;
									} else {
										tableRelations.push(arrayItem);
										const key = arrayItem.tableName || arrayItem.sourceName;
										tablesList[key] = true;
									}
								}
							} else {
								if (
									(bodyFieldObject.tableName || bodyFieldObject.name) &&
									(tablesList[bodyFieldObject.tableName] ||
										tablesList[bodyFieldObject.name])
								) {
									continue;
								} else {
									tableRelations.push(bodyFieldObject);
									const tableName =
										bodyFieldObject.tableName || bodyFieldObject.name;
									tablesList[tableName] = true;
								}
							}
						}
					} else {
						if (requestField && requestField.length) {
							//Loop through Other request Fields
							for (const property of requestField) {
								let propertyName = Object.keys(property).length
									? Object.keys(property)[0]
									: null;
								if (propertyName) {
									const tableName =
										property[propertyName].tableName ||
										property[propertyName].name;
									if (tableName && tablesList[tableName]) {
										continue;
									} else {
										tableRelations.push(property[propertyName]);
										tablesList[tableName] = true;
									}
								}
							}
						}
					}
				}
				//for Response Data
				if (responseData && responseData.length) {
					//loop through all statusCodes responses
					for (const response of responseData) {
						let responseHeaders = response.headers || null;
						//for EachStatusCode response header
						if (responseHeaders && responseHeaders.length) {
							for (const header of responseHeaders) {
								let headerProperty = Object.keys(header)[0];
								const tableName = header[headerProperty].tableName;
								if (tableName && tablesList[tableName]) {
									continue;
								} else {
									tableRelations.push(header[headerProperty]);
									tablesList[tableName] = true;
								}
							}
						}
						let responseBodyProperties;
						if (
							response.content &&
							(response.content.properties || response.content.name)
						) {
							if (response.content.properties) {
								responseBodyProperties = Object.keys(response.content.properties);
							} else {
								responseBodyProperties = [response.content];
							}
							for (const bodyProperty of responseBodyProperties) {
								let bodyFieldObject;
								if (response.content.properties) {
									bodyFieldObject = response.content.properties[bodyProperty];
								} else {
									bodyFieldObject = bodyProperty;
								}

								if (bodyFieldObject.type == 'arrayOfObjects') {
									const arrayKeys =
										bodyFieldObject.items && bodyFieldObject.items.properties
											? Object.keys(bodyFieldObject.items.properties)
											: [];
									for (const eachKey of arrayKeys) {
										const arrayItem = bodyFieldObject.items.properties[eachKey];

										if (
											(arrayItem.tableName || arrayItem.sourceName) &&
											tablesList[arrayItem.tableName || arrayItem.sourceName]
										) {
											continue;
										} else {
											tableRelations.push(arrayItem);
											const key = arrayItem.tableName || arrayItem.sourceName;
											tablesList[key] = true;
										}
									}
								} else {
									const { name, tableName } = bodyFieldObject;
									const table = tableName || name;
									if (table && tablesList[table]) {
										continue;
									} else {
										tableRelations.push(bodyFieldObject);
										tablesList[table] = true;
									}
								}
							}
						}
					}
				}
			}
		}
		return { tablesList, tableRelations };
	} catch (err) {
		console.log('tablesList error', err.message);
		return { message: err.message };
	}
}

async function getTableRelations(tablesList, projectid) {
	let tableRelationsList = [];
	const tablesListArray = Object.keys(tablesList);
	for (const table of tablesListArray) {
		const tableData = await Tables.findOne({
			projectid,
			table,
			'attributes.foreign': { $exists: true }
		}).lean();
		if (!tableData) {
			const tablesData = await Tables.find({
				projectid,
				'attributes.foreign.table': table
			}).lean();
			if (tablesData) {
				for (const table of tablesData) {
					const is_includes = tablesListArray.includes(table.table);
					if (!is_includes) {
						tablesListArray.push(table.table);
					}
				}
			}
			continue;
		}
		const columns = tableData.attributes;
		const filteredAttributes = columns.filter((col) => !!col.foreign);
		for (const column of filteredAttributes) {
			const {
				table: dependentTable,
				schema: dependentTableSchema,
				column: dependentTableColumn
			} = column.foreign;
			if (!tablesListArray.includes(dependentTable)) {
				tablesListArray.push(dependentTable);
			}
			const tableRelation = {
				mainTable: tableData.table,
				mainTableSchema: tableData.schema,
				mainTableColumn: column.name,
				dependentTable,
				dependentTableColumn,
				dependentTableSchema,
				origin: 'derived',
				relation: 'equals'
			};
			tableRelationsList.push(tableRelation);
		}
	}
	return { tableRelationsList, tablesListArray };
}

async function areEqual(array1, array2) {
	if (array1.length === array2.length) {
		return array1.every((element) => {
			if (array2.includes(element)) {
				return true;
			}

			return false;
		});
	}

	return false;
}
module.exports = { router, publishController };