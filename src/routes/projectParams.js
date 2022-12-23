const express = require('express');
const router = new express.Router();
const shortid = require('shortid');

const auth = require('../authentication/authorization');

const Projects = require('../models/projects');
const ProjectParams = require('../models/projectParams');
const checkUserAccessToProject = require('../middlewares/validators/checkUserAccessToProject');
const errorMessages = require('../utility/errorMessages');

const DataTypeTable = {
	array: {
		type: 'array',
		format: 'array'
	},
	object: {
		type: 'object',
		format: 'object'
	},
	integer: {
		type: 'integer',
		format: 'int32'
	},
	long: {
		type: 'integer',
		format: 'int64'
	},
	float: {
		type: 'number',
		format: 'float'
	},
	double: {
		type: 'number',
		format: 'double'
	},
	string: {
		type: 'string',
		format: 'string'
	},
	byte: {
		type: 'string',
		format: 'byte'
	},
	binary: {
		type: 'string',
		format: 'binary'
	},
	arrayOfObjects: {
		type: 'arrayOfObjects',
		format: 'arrayOfObjects'
	},
	boolean: {
		type: 'boolean',
		format: ''
	},
	date: {
		type: 'string',
		format: 'date'
	},
	dateTime: {
		type: 'string',
		format: 'date-time'
	},
	password: {
		type: 'string',
		format: 'password'
	}
};

router.get('/projectParams/get/:projectId', auth, checkUserAccessToProject, async (req, res) => {
	try {
		const projectId = req.params.projectId;
		const parameters = await ProjectParams.findOne({ projectId });
		console.log(parameters);
		if (!parameters) {
			return res.status(200).send([]);
		} else {
			return res.status(200).send(parameters);
		}
	} catch (error) {
		res.status(400).send({ error: error.message });
	}
});

router.post('/projectParams/add', auth, checkUserAccessToProject, async (req, res) => {
	try {
		const projectId = req.body.projectId;
		const body = req.body.data;
		const data = {
			id: shortid.generate(),
			name: body.name,
			type: DataTypeTable[body.type].type,
			commonName: body.type,
			format: DataTypeTable[body.type].format,
			description: body.description,
			required: body.required,
			possibleValues: body.possibleValues || null
		};
		const checkRecord = await ProjectParams.findOne({ projectId });

		var projectParam;
		if (!checkRecord) {
			projectParam = new ProjectParams({ projectId: projectId });
			projectParam.data.push(data);
			projectParam.save();
			res.status(200).send(projectParam);
		} else {
			const duplicateAttributeName = checkRecord.data.find((ob) => ob.name === data.name);

			if (duplicateAttributeName) {
				return res.status(400).send({ error: errorMessages.DUPLICATE_ATTRIBUTE_NAME });
			}
			checkRecord.data.push(data);
			checkRecord.save();
			res.status(200).send(checkRecord);
		}
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: error.message });
	}
});

router.patch('/projectParams/delete', auth, checkUserAccessToProject, async (req, res) => {
	try {
		const projectId = req.body.projectId;
		const paramId = req.body.paramId;
		const projectParam = await ProjectParams.findOne({ projectId });
		// console.log(projectParam);
		if (!projectParam) {
			return res.status(400).send({ error: 'No record exists' });
		}
		const params = projectParam.data;
		// console.log(params);

		const param = params.find((item) => {
			if (item.id == paramId) {
				console.log(item);
				return item;
			}
		});

		const index = params.indexOf(param);
		if (index > -1) {
			params.splice(index, 1);
		}
		projectParam.save();
		return res.status(200).send(params);
	} catch (error) {
		res.status(400).send({ error: error.message });
	}
});

router.patch('/projectParams/edit', auth, checkUserAccessToProject, async (req, res) => {
	try {
		const projectId = req.body.projectId;

		var paramId = req.body.data.paramId;
		var name = req.body.data.name;
		var type = req.body.data.type;
		var commonName = req.body.data.commonName;
		var format = req.body.data.format;
		var description = req.body.data.description;
		var required = req.body.data.required;
		var possibleValues = req.body.data.possibleValues;

		const record = await ProjectParams.findOne({ projectId });
		if (!record) {
			return res.status(200).send([]);
		}
		const data = record.data;
		const parameter = data.find((item) => {
			if (item.id == paramId) {
				return item;
			}
		});
		if (!parameter) {
			return res.status(200).send([]);
		}
		console.log(parameter);

		parameter.name = name ? name : parameter.name;
		parameter.type = type ? type : parameter.type;
		parameter.commonName = commonName ? commonName : parameter.commonName;
		parameter.format = format ? format : parameter.format;
		parameter.description = description ? description : parameter.description;
		parameter.required = required ? required : parameter.required;
		parameter.possibleValues = possibleValues ? possibleValues : parameter.possibleValues;
		record.save();
		res.status(200).send(parameter);
	} catch (error) {
		console.error(error);
		res.status(400).send({ error: error.message });
	}
});

module.exports = router;
