const express = require('express');
const router = new express.Router();
const auth = require('../authentication/authorization');
const DataTypes = require('../models/dataTypes');

router.get('/dataTypes', async (req, res) => {
	try {
		const dataTypes = await DataTypes.findOne({});
		console.log(dataTypes.dataTypes);
		res.status(200).send(dataTypes.dataTypes);
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: error.message });
	}

	// const data = [
	// 	{
	// 		commonName: 'integer',
	// 		type: 'integer',
	// 		format: 'int32'
	// 	},
	// 	{
	// 		commonName: 'long',
	// 		type: 'integer',
	// 		format: 'int64'
	// 	},
	// 	{
	// 		commonName: 'float',
	// 		type: 'number',
	// 		format: 'float'
	// 	},
	// 	{
	// 		commonName: 'double',
	// 		type: 'number',
	// 		format: 'double'
	// 	},
	// 	{
	// 		commonName: 'string',
	// 		type: 'string',
	// 		format: ''
	// 	},
	// 	{
	// 		commonName: 'byte',
	// 		type: 'string',
	// 		format: 'byte'
	// 	},
	// 	{
	// 		commonName: 'binary',
	// 		type: 'string',
	// 		format: 'binary'
	// 	},
	// 	{
	// 		commonName: 'boolean',
	// 		type: 'boolean',
	// 		format: ''
	// 	},
	// 	{
	// 		commonName: 'date',
	// 		type: 'string',
	// 		format: 'date'
	// 	},
	// 	{
	// 		commonName: 'dateTime',
	// 		type: 'string',
	// 		format: 'date-time'
	// 	},
	// 	{
	// 		commonName: 'password',
	// 		type: 'string',
	// 		format: 'password'
	// 	}
	// ];

	// const dataType = new DataTypes({ dataTypes: {} });
	// const temp = new Map();
	// for (var i = 0; i < data.length; i++) {
	// 	const temp2 = {
	// 		type: data[i].type,
	// 		format: data[i].format
	// 	};
	// 	temp.set(data[i].commonName, temp2);
	// }

	// console.log(temp);
	// dataType.dataTypes = temp;
	// dataType.save();
	// res.send(dataType.dataTypes);
});

module.exports = router;
