const express = require('express');
const router = new express.Router();
const { v4: uuidv4 } = require('uuid');
const shortid = require('shortid');

const auth = require('../authentication/authorization');
const validator = require('../middlewares/validators/middleware');
const requests = require('../middlewares/validators/resources');
const Resources = require('../models/resources');
const Projects = require('../models/projects');
const OperationData = require('../models/operationData');
const errorMessages = require('../utility/errorMessages');

router.get('/resources/:id', auth, async (req, res) => {
	try {
		const projectId = req.params.id;
		const author = req.user.user_id;

		let query = {
			$and: [
				{ projectId },
				{ $or: [{ author: req.user_id }, { 'members.email': req.user.email }] },
				{ isDeleted: false }
			]
		};

		const project = await Projects.findOne(query);
		if (!project) {
			return res.status(400).send({
				error: errorMessages.PROJECT_NOT_FOUND
			});
		}
		var i;
		const resources = project.resources;
		const resourcesList = [];
		for (i = 0; i < resources.length; i++) {
			resourcesList.push(resources[i].resource);
		}

		console.log({ prj: project.resources, resourcesList });

		const resourceQuery = { resourceId: { $in: resourcesList } };
		const resourcesData = await Resources.find(resourceQuery);

		res.status(200).send(resourcesData);
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: error.message });
	}
});

router.post('/resources', auth, validator(requests.resourceAddRequest), async (req, res) => {
	try {
		const resourceName = req.body.resourceName;
		let resourceId = uuidv4();

		const projectId = req.body.projectId;
		const projectAuthor = req.user.user_id;
		const query = { projectId: projectId, author: projectAuthor };

		const project = await Projects.findOne(query);
		// console.log('project id ', project, projectAuthor);
		if (!project) {
			return res.status(400).send({
				error: errorMessages.PROJECT_NOT_FOUND
			});
		} else {
			const prevResources = project.resources ? project.resources : [];
			project.resources = [...prevResources, { resource: resourceId }];
			await project.save();
		}

		const resource = new Resources({ resourceName: resourceName, resourceId: resourceId });
		await resource.save();
		res.status(200).send(resource);
	} catch (error) {
		res.status(400).send({ error: error.message });
	}
});

router.delete(
	'/project/:id/resources/:id2',
	auth,
	validator(requests.deleteResourceReq),
	async (req, res) => {
		try {
			const projectId = req.params.id;
			const resourceId = req.params.id2;

			console.log(projectId, resourceId);

			const projectAuthor = req.user.user_id;
			const query = { projectId: projectId, author: projectAuthor };

			const project = await Projects.findOne(query);
			if (!project) {
				return res.status(400).send({
					error: errorMessages.PROJECT_NOT_FOUND
				});
			} else {
				const prevResources = project.resources ? project.resources : [];
				let newResources = prevResources.filter((item) => {
					return item.resource !== resourceId;
				});
				project.resources = newResources;
				await project.save();
			}
			await deleteOperationData('resource', resourceId);

			var operationIds = [];
			const resource = await Resources.findOne({ resourceId: resourceId });
			const paths = resource.path;

			for (path of paths) {
				var operations = path.operations;
				for (operation of operations) {
					operationIds.push(operation.operationId);
				}
			}
			console.log(operationIds);
			await OperationData.deleteMany({ id: { $in: operationIds } });
			console.log('OperationData records deleted');

			console.log('deleting Res..', resourceId);
			await Resources.deleteOne({ resourceId: resourceId });
			res.status(200).send({ message: 'Resource deleted.' });
		} catch (error) {
			res.status(400).send({ error: error.message });
		}
	}
);

router.patch(
	'/resources/:id/rename',
	auth,
	validator(requests.renameResourceReq),
	async (req, res) => {
		try {
			const resourceId = req.params.id;
			const resourceName = req.body.resourceName;
			if (!resourceName) {
				return res.status(400).send({ error: errorMessages.PARAMS_REQUIRES_RES_NAME });
			}

			const resource = await Resources.findOne({ resourceId });
			if (!resource) {
				return res.status(400).send({ error: errorMessages.INVALID_RESOURCE });
			}

			resource.resourceName = resourceName;
			await resource.save();
			res.send({ message: 'update sucessful', resource });
		} catch (error) {
			res.status(400).send({ error: error.message });
		}
	}
);

/*Path APIs */

router.patch('/path/add', auth, validator(requests.addPathRequest), async (req, res) => {
	const resourceId = req.body.resourceId;

	console.log('updating res..', resourceId);
	const resource = await Resources.findOne({ resourceId });

	if (!resource) {
		return res.status(400).send({ error: errorMessages.INVALID_RESOURCE });
	}

	const pathData = {
		pathId: shortid.generate(),
		pathName: req.body.pathName
	};
	console.log('updating pathData..', pathData);

	resource.path = [...resource.path, pathData];
	await resource.save();
	res.send({ message: 'update sucessful', resource });
});

router.patch('/path/rename', auth, validator(requests.renamePathRequest), async (req, res) => {
	try {
		const resourceId = req.body.resourceId;
		const pathId = req.body.pathId;
		const pathName = req.body.pathName;

		const resource = await Resources.findOne({ resourceId });
		if (!resource) {
			return res.status(400).send({ error: errorMessages.INVALID_RESOURCE });
		}

		const paths = await resource.path;
		const path = paths.find((item) => {
			if (item.pathId == pathId) {
				return item;
			}
		});
		if (!path) {
			return res.status(400).send({ error: errorMessages.INVALID_PATH });
		}

		var prevName = path.pathName;
		path.pathName = pathName;
		await resource.save();

		var operationIds = [];
		const operations = path.operations;
		for (operation of operations) {
			operationIds.push(operation.operationId);
		}
		const query = { id: { $in: operationIds } };
		const operationData = await OperationData.find(query);

		for (item of operationData) {
			item.data.endpoint = item.data.endpoint.replace(prevName, pathName);
			await item.save();
		}
		res.status(200).send({ message: 'Rename Successful', path });
	} catch (error) {
		res.status(400).send({ error: error.message });
	}
});

router.patch('/path/delete', auth, validator(requests.deletePathRequest), async (req, res) => {
	try {
		const resourceId = req.body.resourceId;
		const pathId = req.body.pathId;

		const resource = await Resources.findOne({ resourceId });
		if (!resource) {
			return res.status(400).send({ error: errorMessages.INVALID_RESOURCE });
		}

		const paths = await resource.path;
		const path = await paths.find((item) => {
			if (item.pathId == pathId) {
				return item;
			}
		});
		if (!path) {
			return res.status(400).send({ error: errorMessages.INVALID_PATH });
		}
		console.log(path);
		const index = paths.indexOf(path);

		var operationIds = [];
		var operations = path.operations;
		for (operation of operations) {
			operationIds.push(operation.operationId);
		}
		console.log(operationIds);
		await OperationData.deleteMany({ id: { $in: operationIds } });
		console.log('OperationData records deleted');

		if (index > -1) {
			paths.splice(index, 1);
		}

		await resource.save();
		res.status(200).send({ message: 'Deletion Successful', resource });
	} catch (error) {
		res.status(400).send({ error: error.message });
	}
});

/* Operation APIs */

router.patch('/operation/add', auth, validator(requests.addOperationRequest), async (req, res) => {
	try {
		const projectId = req.body.projectId;
		const resourceId = req.body.resourceId;
		const pathId = req.body.pathId;
		const operationName = req.body.operationName;
		const operationType = req.body.operationType;
		const operationDescription = req.body.operationDescription;

		const resource = await Resources.findOne({ resourceId });
		if (!resource) {
			return res.status(400).send({ error: errorMessages.INVALID_RESOURCE });
		}

		const paths = await resource.path;
		const path = paths.find((item) => {
			if (item.pathId == pathId) {
				return item;
			}
		});
		// const path = await paths.filter((item) => pathId == item.pathId);
		if (!path) {
			return res.status(400).send({ error: errorMessages.INVALID_PATH });
		}
		const operationId = uuidv4();
		const operationData = {
			operationType: operationType,
			operationId: operationId,
			operationName: operationName,
			operationDescription: operationDescription
		};

		path.operations.push(operationData);
		await resource.save();

		const operationDataReqRes = new OperationData({
			projectid: projectId,
			id: operationId,
			data: {
				method: operationType.toLowerCase(),
				operationId: operationType.toLowerCase() + ' /' + operationName,
				endpoint: `/${path.pathName}`
			}
		});
		operationDataReqRes.save();
		res.status(200).send({ operationId: operationData.operationId });
	} catch (error) {
		res.status(400).send({ error: error.message });
	}
});

router.patch(
	'/operation/edit/:id',
	auth,
	validator(requests.editOperationRequest),
	async (req, res) => {
		try {
			const resourceId = req.body.resourceId;
			const pathId = req.body.pathId;
			const operationId = req.params.id;

			if (!resourceId) {
				return res.status(400).send({ error: errorMessages.EMPTY_RES_ID });
			}
			const resource = await Resources.findOne({ resourceId });
			if (!resource) {
				return res.status(400).send({ error: errorMessages.INVALID_RESOURCE });
			}

			const paths = await resource.path;
			const path = paths.find((item) => {
				// console.log(item);
				if (item.pathId == pathId) {
					// console.log(item);
					return item;
				}
			});
			if (!path) {
				return res.status(400).send({ error: errorMessages.INVALID_PATH });
			}

			const operations = path.operations;
			const operation = operations.find((item) => {
				if (item.operationId == operationId) {
					return item;
				}
			});
			const operationNameBody = req.body.operationName
				? req.body.operationName
				: operation.operationName;
			const operationTypeBody = req.body.operationType
				? req.body.operationType
				: operation.operationType;
			const operationDescriptionBody = req.body.operationDescription
				? req.body.operationDescription
				: operation.operationDescription;

			operation.operationType = operationTypeBody;
			operation.operationName = operationNameBody;
			operation.operationDescription = operationDescriptionBody;
			await resource.save();

			const operationData = await OperationData.findOne({ id: operationId });
			operationData.data.method = operationTypeBody.toLowerCase();
			if (operationTypeBody.toLowerCase() === 'get') {
				operationData.data.requestData.body = {};
			}
			operationData.data.operationId =
				operationTypeBody.toLowerCase() + ' /' + operationNameBody;
			await operationData.save();
			res.status(200).send({ message: 'Edit Successful', operation });
		} catch (error) {
			res.status(400).send({ error: error.message });
		}
	}
);

router.patch(
	'/operation/delete/:id',
	auth,
	validator(requests.deleteOperationRequest),
	async (req, res) => {
		try {
			const resourceId = req.body.resourceId;
			const pathId = req.body.pathId;
			const operationId = req.params.id;

			const resource = await Resources.findOne({ resourceId });
			if (!resource) {
				return res.status(400).send({ error: errorMessages.INVALID_RESOURCE });
			}

			const paths = await resource.path;
			const path = paths.find((item) => {
				// console.log(item);
				if (item.pathId == pathId) {
					// console.log(item);
					return item;
				}
			});

			if (!path) {
				return res.status(400).send({ error: errorMessages.INVALID_PATH });
			}

			const operations = path.operations;

			const operation = operations.find((item) => {
				if (item.operationId == operationId) {
					return item;
				}
			});

			if (!operation) {
				return res.status(400).send({ error: errorMessages.INVALID_OPERATION_ID });
			}

			const index = operations.indexOf(operation);
			if (index > -1) {
				operations.splice(index, 1);
			}

			await resource.save();
			await OperationData.deleteOne({ id: operationId });
			console.log(operations);
			res.status(200).send({ message: 'Deletion Successful', resource });
		} catch (error) {
			res.status(400).send({ error: error.message });
		}
	}
);

async function deleteOperationData(type, id) {}

module.exports = router;
