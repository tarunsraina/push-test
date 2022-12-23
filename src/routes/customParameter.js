const router = require('express').Router();
const shortid = require('shortid');

const authorization = require('../authentication/authorization');
const CustomParameters = require('../models/customParameters');
const Projects = require('../models/projects');
const errorMessages = require('../utility/errorMessages');

//get customParameters
router.get('/customParameters/get/:projectID', authorization, async (req, res) => {
	try {
		const { projectID } = req.params; //extracting projectID from request

		// projectType apiSpec is not allowed
		const error = await checkProjectType(projectID);
		if (error) return throwError(error, res);

		const customParameters = await CustomParameters.findOne({ projectID }); //finding the record with given projectID

		// if there's no record, send empty list otherwise send the custom parameters
		if (!customParameters) {
			return res.status(200).send([]);
		} else {
			return res.status(200).send(customParameters);
		}
	} catch (e) {
		return throwError(e, res);
	}
});

// add custom parameter
router.post('/customParameters/add', authorization, async (req, res) => {
	try {
		const { projectID, data: body } = req.body; //extracting projectID and data from request

		// projectType apiSpec is not allowed
		const error = await checkProjectType(projectID);
		if (error) return throwError(error, res);

		const document = await CustomParameters.findOne({ projectID }); // fetching the record with the given projectID
		if (document) {
			const duplicateAttributeName = document.data.find((ob) => ob.name === body.name);
			if (duplicateAttributeName) {
				return res.status(400).json({ error: errorMessages.DUPLICATE_ATTRIBUTE_NAME });
			}
		}
		const { name, type, description, tableName, columnName, functionName, filters } = body; // destructuring the data object

		if (!name || !type || !tableName || !columnName || !functionName) {
			return throwError(
				{ error: 'name, type, tableName, columnName, functionName are mandatory' },
				res
			);
		}

		const data = {
			customParamID: shortid.generate(), // generate ID for every parameter
			name,
			type,
			tableName,
			key: tableName,
			sourceName: tableName,
			paramType: 'customParam',
			columnName,
			functionName,
			required: false
		};
		if (description) data.description = description;

		//adding filters only if it is present in request body.
		if (filters && filters.length > 0) {
			//if (filters?.length > 0) {
			const updatedFilters = [];
			for (let i in filters) {
				if (Object.keys(filters[i]).length !== 4) {
					return throwError(
						{
							error: `All fields inside the filter ${i} are mandatory`
						},
						res
					);
					break;
				}
				updatedFilters.push({ filterID: shortid.generate(), ...filters[i] });
			}
			data.filters = updatedFilters; // update filters
		}

		// check if document already exists with given projectID
		if (document) {
			try {
				document.data.push(data);
				await document.save();
				return res.status(200).send({ message: 'success' });
			} catch (e) {
				return throwError(e, res);
			}
		}

		//if no record exists, create a new document
		try {
			const parameter = new CustomParameters({ projectID: projectID });
			parameter.data.push(data);
			await parameter.save();
		} catch (e) {
			return throwError(e, res);
		}

		return res.status(200).send({ message: 'success' });
	} catch (e) {
		return throwError(e, res);
	}
});

// delete custom parameter
router.patch('/customParameters/delete', authorization, async (req, res) => {
	try {
		const { projectID, customParamID } = req.body;

		if (!projectID) return throwError({ error: 'projectID should not be empty' }, res); // projectID should not be empty
		if (!customParamID) return throwError({ error: 'customParamID should not be empty' }, res); // customParamID should not be empty

		// projectType apiSpec is not allowed
		const error = await checkProjectType(projectID);
		if (error) return throwError(error, res);

		const document = await CustomParameters.findOne({ projectID });
		if (!document) return throwError({ error: 'No such project found' }, res); //check if a document exists with given projectID

		const parameters = document.data;

		try {
			const updatedParameters = parameters.filter(
				(item) => item.customParamID !== customParamID
			); // returns new array without the parameter which needs to be removed
			document.data = updatedParameters;
			await document.save();
			return res.status(200).send({ message: 'success' });
		} catch (e) {
			return throwError(e, res);
		}
	} catch (e) {
		return throwError(e, res);
	}
});

// edit parameter
router.patch('/customParameters/edit', authorization, async (req, res) => {
	try {
		const { projectID, customParamID, data: body } = req.body;

		if (!projectID) return throwError({ error: 'ProjectID should not be empty' }, res); // projectID should not be empty
		if (!customParamID) return throwError({ error: 'customParamID should not be empty' }, res); // customParamID should not be empty

		// projectType apiSpec is not allowed
		const error = await checkProjectType(projectID);
		if (error) return throwError(error, res);

		const document = await CustomParameters.findOne({ projectID });
		if (!document) return throwError({ error: 'No such project found' }, res); //check if a document exists with given projectID

		try {
			let position, uFilters;

			// fetch parameter which needs to be updated
			let parameter = document.data.find((item, index) => {
				if (item.customParamID == customParamID) {
					position = index;
					return item;
				}
			});
			if (!parameter) return throwError({ error: 'Invalid customParamID' }, res);

			// toObject converts mongoose document/sub-document to regular
			// javascript object so that we can use regular javascript methods
			parameter = parameter.toObject();
			let data = { ...req.body.data };

			// deleting filters as it requires some extra logic
			delete data.filters;

			// update the parameter with other fields
			parameter = { ...parameter, ...data };

			// update filters only if they are present in req body
			if (body.filters && body.filters.length > 0) {
				//if (body.filters?.length > 0) {
				// adds filterID if a new filter is added else does nothing
				uFilters = body.filters.map((item) => {
					if (!item.filterID) {
						item.filterID = shortid.generate();
					}
					return item;
				});
				parameter.filters = uFilters; // update the filtersparameter
			} else {
				parameter.filters = [];
			}

			document.data[position] = parameter;

			await document.save();
			return res.status(200).send({ message: 'success' });
		} catch (e) {
			return throwError(e, res);
		}
	} catch (e) {
		return throwError(e, res);
	}
});

// generic function to throw error
function throwError(error, res) {
	res.status(400).send({ message: 'Some Error Occured', error: error });
}

//check if project type is db or not
async function checkProjectType(projectID) {
	try {
		const project = await Projects.findOne({ projectId: projectID });
		if (!project) return { error: 'project does not exists' };
		else if (project.projectType == 'apiSpec')
			// projectType apiSpec is not allowed
			return { error: 'API is not valid for this project' };
	} catch (e) {
		return e;
	}
}

module.exports = router;
