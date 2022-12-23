const express = require('express');
const router = new express.Router();
const auth = require('../authentication/authorization');
const UserSelMatches = require('../models/userOvrrdMatches');
const validator = require('../middlewares/validators/middleware');
const {
	overrideSchemaMatchReq,
	overrideAttrMatchReq
} = require('../middlewares/validators/userOverrdMatch');
const { publishController } = require('./projects');


router.post('/overrideAttrMatch', auth, validator(overrideAttrMatchReq), async (req, res) => {
	try {
		let projectId = req.body.projectId;
		let user = req.user_id;

		let selectedMatchData = {
			projectId: projectId,
			schemaName: req.body.schema,
			schemaAttribute: req.body.schemaAttribute,
			attributePath: req.body.path,
			attributeLevel: req.body.level,
			tableName: req.body.tableName,
			tableAttribute: req.body.tableAttribute,
			updatedby: user
		};

		let existingData = await UserSelMatches.findOne({
			projectId: projectId,
			schemaName: selectedMatchData.schemaName,
			schemaAttribute: selectedMatchData.schemaAttribute,
			attributePath: selectedMatchData.attributePath
		});

		let userSelMatch;
		if (!!existingData) {
			//Override if already exists
			userSelMatch = existingData;
			userSelMatch.tableName = selectedMatchData.tableName;
			userSelMatch.tableAttribute = selectedMatchData.tableAttribute;
			userSelMatch.updatedby = selectedMatchData.updatedby;
		} else {
			userSelMatch = new UserSelMatches(selectedMatchData);
		}

		await userSelMatch.save();
		res.status(200).send({ userSelMatch });
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: error.message });
	}
});

router.post('/overrideSchemaMatch', auth, validator(overrideSchemaMatchReq), async (req, res) => {
	try {
		let { projectId, schema, data: nData , password } = req.body;
							   
		let user = req.user_id;
							

		// Remove existing data
		if (schema) {
			await UserSelMatches.deleteMany({ projectId, schemaName: schema });
		}

		if (!schema && password) {
			await UserSelMatches.deleteMany({
				projectId,
				schemaName: schema,
				isDesignChange: false
			});
		}
		// Create data for new records containing table & column
		let newOverrideData = [];

		nData.forEach(async (item) => {
			if (item.overridenMatch.tableName && item.overridenMatch.tableAttribute) {
				i/* f (!schema && password) {
					await UserSelMatches.deleteOne({
						projectId,
						schemaName: item.schemaName,
						schemaAttribute: item.name,
						attributePath: item.path
					});
				} */
				let data = {
					projectId: projectId,
					schemaName: item.schemaName || schema,
					schemaAttribute: item.name,
					attributePath: item.path,
					attributeLevel: item.level,
					tableName: item.overridenMatch.tableName,
					tableAttribute: item.overridenMatch.tableAttribute,
					isDesignChange: false,
					updatedby: user
				};

				let nItem = new UserSelMatches(data);
				newOverrideData.push(nItem);
			} else {
				throw new Error('please Fill all the fields');
			}
		});

		// Insert all records
		await UserSelMatches.insertMany(newOverrideData);
		if (!schema && password && password.length) {
			await publishController(req, res);
		} else {
			return res.status(200).send({ newOverrideData, length: newOverrideData.length });
		}
	} catch (error) {
		//console.log(error);
		return res.status(400).send({ error: error.message });
	}
});


module.exports = router;
