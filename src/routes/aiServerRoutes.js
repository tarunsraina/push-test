const express = require('express');
const router = new express.Router();
const request = require('request');
var fs = require('fs');

const auth = require('../authentication/authorization');
const Projects = require('../models/projects');
const aiServerURL = process.env.AI_SERVER_URL;
const uploadsDirectory = process.env.FILE_UPLOAD_PATH;

router.post('/aiMatcher', auth, async (req, res) => {
	//this request may take around 10 mins to complete
	let timeout = 10 * 60 * 1000;
	req.socket.setTimeout(timeout);

	let projectid = req.body.projectId;
	const query = { isDeleted: false, projectId: projectid };
	let project = await Projects.findOne(query);
	if (!project) {
		res.status(404).json({ error: 'Project id not found' });
		req.socket.destroy();
		return;
	}
	console.log({ project });

	try {
		let url = aiServerURL + '/matcher';
		let options = {
			url: url,
			body: { projectid },
			json: true,
			timeout: timeout
		};

		request.post(options, async function (err, httpResponse, body) {
			let statusCode;
			if (httpResponse && httpResponse.statusCode) {
				statusCode = httpResponse.statusCode;
			}
			if (err) {
				console.log('Error!', err);
				// project.status = 'MATCHER_ERROR';
				// await project.save();

				await removeProject(project);
				res.status(statusCode).send({ error: err });
				req.socket.destroy();
				return;
			} else {
				console.log('Response: ' + body);
				let aiResponse = body;
				let status = aiResponse && aiResponse.status ? aiResponse.status : statusCode;

				if (status != 200) {
					await removeProject(project);
				}

				res.status(status).send({
					projectId: projectid,
					aiResponse: aiResponse
				});
				req.socket.destroy();
				return;
			}
		});
	} catch (error) {
		// project.status = 'MATCHER_ERROR';
		// await project.save();
		await removeProject(project);
		res.status(400).send({ error: error.message });
		req.socket.destroy();
		return;
	}
});

async function removeProject(project) {
	try {
		console.log('Removing project');

		//Delete related files from file system if any
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

		// Delete project
		await project.remove();
	} catch (err) {
		console.log(`Error deleting project`, err);
	}
}

module.exports = router;
