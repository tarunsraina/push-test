const express = require('express');
const router = new express.Router();
const auth = require('../authentication/authorization');
const SchemaData = require('../models/schemas');
const Matcher = require('../models/matchers');
// const Components = require('../models/components');
const validator = require('../middlewares/validators/middleware');
const requests = require('../middlewares/validators/schemas');
const shortid = require('shortid');

router.post('/schemasList', auth, validator(requests.schemaListRequest), async (req, res) => {
	try {
		let projectId = req.body.projectId;
		let schemaData = await SchemaData.find({ projectid: projectId });
		if (!schemaData) {
			return res.status(404).send('');
		}

		let filterlevelZero = true;
		const nSchemaArray = await getModifiedSchema(schemaData, projectId, filterlevelZero);
		res.status(200).send({ nSchemaArray });
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: error.message });
	}
});

router.post('/subSchemaData', auth, validator(requests.subSchemaRequest), async (req, res) => {
	try {
		let projectId = req.body.projectId;
		let refType = req.body.type;
		let ref = req.body.ref;
		let schemaData;

		if (refType == 'ezapi_ref') {
			let schemaName = ref;
			console.log({ schemaName });
			schemaData = await SchemaData.find({
				'data.name': schemaName,
				projectid: projectId
			});

			if (!schemaData) {
				throw new Error(`Could not find sub schema : ${schemaName}`);
			}

			let filterlevelZero = true; //for schema get level 0 element
			let nSchemaArray = await getModifiedSchema(schemaData, projectId, filterlevelZero);
			res.status(200).send({ nSchemaArray });
		} else {
			//else type is array or object ref will consist of schemaName.parentPath
			let refArr = ref.split('.');
			let schemaName = refArr.shift();
			let parent = refArr.join('.');

			schemaData = await SchemaData.findOne({
				'data.name': schemaName,
				projectid: projectId
			});

			if (!schemaData) {
				throw new Error(`Could not find sub schema : ${schemaName}`);
			}

			let nSchemaArray = await getModifiedSchema([schemaData], projectId);

			//filter the child
			let attributesArr = nSchemaArray[0].data.filter((item) => item.parent == parent);
			schemaData.data = attributesArr;

			res.status(200).send({ data: attributesArr });
		}
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: error.message });
	}
});

async function getModifiedSchema(schemaData, projectId, islevelZero = false) {
	let nSchemas = [];
	let nRefs = [];

	for (schItem of schemaData) {
		let schemaItem = schItem.toObject();
		let schemaName = schemaItem.data.name;

		let attributeDataMap = {};
		let schemaMatchType = '';

		//find all docs from matcher corresponding to the schema
		let match = await Matcher.find({ schema: schemaName, projectid: projectId });

		let isFull = false;
		let isPartial = false;

		//Check if theres ANY Full match else ANY Partial match
		if (match) {
			isFull =
				match.filter((item) => {
					let _item = item.toObject();
					return _item.match_type == 'Full';
				}).length > 0;

			isPartial =
				match.filter((item) => {
					let _item = item.toObject();
					return _item.match_type == 'Partial';
				}).length > 0;
		}

		//Populate the matchtype for schema
		schemaMatchType = isFull ? 'Full' : isPartial ? 'Partial' : 'No Match';

		if (schemaMatchType !== 'No Match') {
			for (item of match) {
				let matchItem = item.toObject();

				matchItem.attributes.forEach((item) => {
					let recordVal = attributeDataMap[item.schema_attribute];
					if (
						recordVal &&
						(recordVal.match_type == 'Full' || recordVal.match_type == 'Partial')
					) {
						return;
					} else {
						attributeDataMap[item.schema_attribute] = {
							match_type: item.match_type ? item.match_type : null
						};
					}
				});
			}
		}

		// new schema object
		let newSchemaSturcture = {
			name: schemaName,
			match_type: schemaMatchType,
			type: 'ezapi_ref', // type suggests what is the ref type, and all the schemas will be of ref type ezapi_ref
			ref: schemaName, // A schema can be refrenced by schema name directly
			payloadId: shortid.generate()
		};

		//populate attribute matchtype to new Schema Object
		let nAttributes = schemaItem.data.attributes.map((attItem) => {
			let attribute = {
				name: attItem.name,
				level: attItem.level,
				match_type: attributeDataMap[attItem.name]
					? attributeDataMap[attItem.name].match_type
					: 'No Match',
				required: attItem.required,
				parent: attItem.parent,
				is_child: attItem.is_child,
				type: attItem.type,
				format: attItem.format,
				payloadId: shortid.generate()
			};

			if (attItem.ref) {
				attribute.ref = attItem.ref;
			} else if (
				attItem.is_child == false &&
				(attItem.type == 'array' || attItem.type == 'object')
			) {
				// custom ref for array and object type
				let parentStr = attItem.parent ? '.' + attItem.parent : '';
				attribute.ref = schemaName + parentStr + '.' + attItem.name;
			}

			return attribute;
		});

		//show only level 0 attributes
		if (islevelZero) {
			newSchemaSturcture.data = nAttributes.filter((item) => item.level == '0');
		} else {
			newSchemaSturcture.data = nAttributes;
		}

		nSchemas.push(newSchemaSturcture);
	}

	return nSchemas;
}

module.exports = router;
