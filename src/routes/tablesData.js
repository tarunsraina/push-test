const express = require('express');
const router = new express.Router();
const auth = require('../authentication/authorization');
const validator = require('../middlewares/validators/middleware');
const requests = require('../middlewares/validators/schemas');
const MongoCollections = require('../models/mongoCollections');
const Projects = require('../models/projects');
const tablesData = require('../models/tables');
const shortid = require('shortid');
const _ = require('lodash');

router.post('/tablesLookup', auth, async (req, res) => {
	try {
		let projectId = req.body.projectId;
		let tableFilter = req.body.tableFilter;
		console.log({ projectId });
		let tables = await tablesData.find({ projectid: projectId });
		if (!tables) {
			throw new Error('No tables found for this projectId');
		}

		let lookupData;
		if (!tableFilter) {
			lookupData = [];
			for (item of tables) {
				item = item.toObject();
				let modifiedAttributes = modify(item.attributes);
				let data = {
					name: item.schema + "." + item.table,
					type: 'ezapi_table',
					data: modifiedAttributes
				};
				lookupData.push(data);
			}
		} else {
			tables.find((item) => {
				item = item.toObject();
				if (item.table == tableFilter) {
					lookupData = {
						name: item.schema + '.' + item.table,
						type: 'ezapi_table',
						data: modify(item.attributes)
					};
				}
			});
		}

		res.status(200).send(lookupData);
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: error.message });
	}
});

router.post('/tableSubSchema', auth, validator(requests.subSchemaRequest), async (req, res) => {
	try {
		let { projectId, type: refType, ref } = req.body;					 
		let schemaData;
		let refArr = ref.split('.');
		let collectionName = refArr.shift();
		let refPath = refArr.join('.');
		// elmntPath = elmntPath + '.ezapi_object';
		let queryCondition;
		let query = {
			projectid: projectId,
			collection: collectionName
		};
		let retrieveInfo = {};
		queryCondition = refPath;
		query[queryCondition] = { $exists: true };
		retrieveInfo[queryCondition] = 1;

		schemaData = await MongoCollections.findOne(query, retrieveInfo).lean();
		if (!schemaData) {
			throw new Error(`Could not find sub schema : ${collectionName}`);
		}
		let temp = _.get(schemaData, queryCondition);
		let modifiedAttributes = getNoSQLAttributes(temp, collectionName, refType);
		return res.status(200).send({ data: modifiedAttributes });		
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: error.message, message: 'ref or projectId mismatch'});
	}
});

router.post('/tablesData', auth, async (req, res) => {
	try {
		let projectId = req.body.projectId;
		console.log({ projectId });
		const project = await Projects.findOne({ projectId });
		if (project.dbDetails.dbtype && project.dbDetails.dbtype === 'mongo') {
			let mongoCollections = await MongoCollections.find({ projectid: projectId });
			let mongoCollectionData = [];
			for (item of mongoCollections) {
				item = item.toObject();
				let modifiedAttributes = getNoSQLAttributes(item.attributes, item.collection, '');
				let data = { 
					name: item.collection,
					sourceName: item.collection,
					key: item.collection,
					type: 'ezapi_collection',
					payloadId: shortid.generate(),
					selectedColumns: modifiedAttributes
				}
				mongoCollectionData.push(data);
			}
			return res.status(200).send(mongoCollectionData);
		} else {
			let tables = await tablesData.find({ projectid: projectId });
			if (!tables) {
				throw new Error('No tables found for this projectId');
			}
			let tableData = [];
			for (item of tables) {
				item = item.toObject();
				let modifiedAttributes = modify(item.attributes, item.table, item.key);
				let data = {
					name: item.table,
					sourceName: item.table,
					key: item.key,
					type: 'ezapi_table',
					payloadId: shortid.generate(),
					selectedColumns: modifiedAttributes
				};
				tableData.push(data);
			}
			res.status(200).send(tableData);
		}
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: error.message });
	}
});

function getNoSQLAttributes(attributes, collectionName, key){
	var data = [];
	var listofattributes = Object.keys(attributes);
	/* if (key && key === "array") {
		listofattributes = Object.keys(attributes);
	} else  {
		listofattributes = Object.keys(attributes);
	} */
	for (attribute of listofattributes) {
		if (attribute) {
			var temp = {
				name: attribute,
				auto: false,
				required: false,
				type: attributes[attribute].ezapi_type,
				format: attributes[attribute].ezapi_type
			}

			if (attributes[attribute].ezapi_type == 'object') {
				temp.isChild = false;
			} else if (attributes[attribute].ezapi_type == 'array') {
					if (attributes[attribute].ezapi_array.ezapi_object) {
						temp.isChild = false;
					} else {
						temp.isChild = true;
					}				
			} else {
				temp.isChild = true;
			}

			if (collectionName) {
				temp.sourceName = attribute;
				temp.key = collectionName;
				temp.tableName = collectionName;
				temp.paramType = 'documentField';
				temp.payloadId = shortid.generate();
			}

			data.push(temp);
		}
	}
	return data;
}

function modify(attributes, tableName, key) {
	var data = [];
	for (attribute of attributes) {
		if (attribute) {
			var temp = {
				auto: attribute.auto,
				name: attribute.name,
				required: attribute.valueconstraint ? true : false,
				type: attribute.openapi ? attribute.openapi.type : 'string',
				format: attribute.openapi ? attribute.openapi.format : null
			};
			if (attribute.foreign) {
				temp.foreign = attribute.foreign;
			}
			if (attribute.keyType) {
				temp.keyType = attribute.keyType;
			}
			// adding table name, frontend needs table name for each column
			if (tableName) {
				temp.sourceName = attribute.name;
				temp.key = key;
				temp.tableName = tableName;
				temp.paramType = 'column';
				temp.payloadId = shortid.generate();
			}

			data.push(temp);
		}
	}
	return data;
}

module.exports = router;
