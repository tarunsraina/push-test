const express = require('express');
const router = new express.Router();
const fs = require('fs');
const path = require('path');
const { Storage } = require('@google-cloud/storage');
const { exec } = require('child_process');
const AdmZip = require('adm-zip');
const archiver = require('archiver');

const auth = require('../authentication/authorization');
const genspec = require('../models/genspec');
const testcases = require('../models/testcases');
const test_result = require('../models/test_result');
const virtual = require('../models/virtual');
const sankey = require('../models/sankey');
const Projects = require('../models/projects');
const dbdata = require('../models/dbdata');
const database = require('../models/database');

const mongoUtil = require('../mongoUtil');
// var _ = require('lodash');
const currentdeployenv = process.env.DEPLOYMENT_ENV;
const aiServerURL = process.env.AI_SERVER_URL;

const removeLocalStorgae = (filepath) => {
	try {
		fs.unlinkSync(filepath);
		console.log(`${filepath} successfully deleted from the local storage`);
	} catch (err) {
		console.log(`Error deleting ${filepath} - ${err}`);
	}
};

const uploadAndGetSignedURL = async (bucketName, bucketFolder, uploadPath, filename) => {
	const storage = new Storage();

	const filepath = `${bucketFolder}/${filename}`;

	await storage.bucket(bucketName).upload(uploadPath, {
		destination: filepath,
		gzip: true,
		metadata: {
			cacheControl: 'public, max-age=31536000'
		}
	});

	const options = {
		version: 'v4',
		action: 'read',
		expires: Date.now() + 15 * 60 * 1000 // 15 minutes
	};

	const [url] = await storage.bucket(bucketName).file(filepath).getSignedUrl(options);

	return url;
};

// Download Spec
router.post('/download_spec', auth, async (req, res) => {
	try {
		let projectid = req.body.projectId;
		let spec_data = await genspec.findOne({ projectid: projectid });

		if (spec_data) {
			spec_data = JSON.stringify(spec_data);
			spec_data = spec_data.replace(/ezapi_ref/g, '$ref');
			// spec_data = spec_data.replaceAll("ezapi_ref", "$ref")
			spec_data = JSON.parse(spec_data);
			spec_data = spec_data.data;

			let offlinePath = 'offline/';
			if (!fs.existsSync(offlinePath)) {
				fs.mkdirSync(offlinePath);
			}

			outfile = offlinePath + 'spec.json';
			fs.writeFile(outfile, JSON.stringify(spec_data, null, 4), (err) => {
				if (err) {
					console.log(`error: ${err}`);
				}

				const bucketName = 'ezpai-poc';
				const bucketFolder = 'proj_' + projectid;
				const filepath = outfile;
				const filename = 'proj_spec.json';

				uploadAndGetSignedURL(bucketName, bucketFolder, filepath, filename)
					.then((value) => {
						console.log('url - ', value);
						res.status(200).json({ downloadUrl: value });
						removeLocalStorgae(filepath);
					})
					.catch((err) => {
						console.log('url - ', err);
						res.status(500).json({ error: err.message });
						removeLocalStorgae(filepath);
					});
			});
		}
	} catch (error) {
		console.log(error);
		removeLocalStorgae(filepath);
		res.status(400).send({ error: error.message });
	}
});
router.post('/download_apigee', auth, async (req, res) => {
	try {
		const projectid = req.body.projectId;
		let spec_data = await genspec.findOne({ projectid: projectid });
		if (spec_data) {
			spec_data = JSON.stringify(spec_data);
			spec_data = spec_data.replace(/ezapi_ref/g, '$ref');
			spec_data = JSON.parse(spec_data);
			spec_data.data.schemes = ['http', 'https'];
			spec_data.data.swagger = '2.0';
			delete spec_data.data.openapi;
			spec_data = spec_data.data;

			let folder = `proj_${projectid}/`;
			if (!fs.existsSync(folder)) {
				fs.mkdirSync(folder);
			}
			specfile = folder + 'spec.json';
			fs.writeFile(specfile, JSON.stringify(spec_data, null, 4), (err) => {
				if (err) {
					console.log(`error: ${err}`);
					throw 'unable to generate spec file';
				}
				const cmd = `openapi2apigee generateApi apiproxy -s proj_${projectid}/spec.json -d proj_${projectid}`;
				exec(cmd, (err, stdout, stderr) => {
					if (stdout) {
						if (fs.existsSync(`proj_${projectid}/apiproxy`)) {
							const filePath = folder + `apiproxy/apiproxy.zip`;
							const bucketName = 'ezpai-poc';
							const bucketFolder = 'proj_' + projectid;
							const filename = 'apiproxy.zip';
							uploadAndGetSignedURL(bucketName, bucketFolder, filePath, filename)
								.then((value) => {
									res.status(200).json({ downloadUrl: value });
									removeLocalStorgae(`proj_${projectid}`);
								})
								.catch((err) => {
									res.status(500).json({ error: err.message });
									removeLocalStorgae(`proj_${projectid}`);
								});
						}
					}
				});
			});
		} else {
			return res.status(400).json({ message: 'No spec data for the given projectId' });
		}
	} catch (err) {
		removeLocalStorgae(`proj_${projectid}`);
		return res.status(400).send({ error: error.message });
	}
});
//API to download database for connect DB feature
router.post('/download_gendata', auth, async (req, res) => {
	let projectid = req.body.projectId;
	let os_type = req.body.os_type ? req.body.os_type : 'others';
	let dbname = null;
	let offlinePath = 'offline/';
	let timeout = 10 * 60 * 1000;
	req.socket.setTimeout(timeout);

	if (!fs.existsSync(offlinePath)) {
		fs.mkdirSync(offlinePath);
	}

	try {
		let dbgen_data = await dbdata.find({ projectid: projectid }, { _id: 0 });
		let project_data = await Projects.findOne({ projectId: projectid });
		let testcasedata = await testcases.find({ projectid: projectid }, { _id: 0 });

		dbname = 'proj_dbgen_' + projectid;
		const { client, db } = await mongoUtil.connectToServer(dbname);

		if (!dbgen_data) {
			return res.status(404).send({ message: 'Data not generated for the project' });
		}
		if (!project_data) {
			return res.status(404).send({ message: 'Project Not found' });
		}
		try {
			await db.collection('dbdata').insertMany(dbgen_data);
			if (testcasedata) {
				await db.collection('testcases').insertMany(testcasedata);
			}
			let mongo_url = process.env.MONGO_CONNECTION;
			const dump_db = offlinePath + dbname;

			const master_upd_filename = offlinePath + dbname + '.json';
			let master_dump = {};

			if (project_data['projectType'] != 'schema') {
				master_dump = {
					userid: project_data['author'],
					projectName: project_data['projectName'],
					projectType: project_data['projectType'],
					filename: null,
					dbname: dbname,
					status: true,
					api_ops_id: projectid,
					projectid: projectid,
					lastGenType: project_data['lastGenType']
				};
			} else {
				master_dump = {
					userid: project_data['author'],
					projectName: project_data['projectName'],
					projectType: project_data['projectType'],
					filename: null,
					dbname: dbname,
					status: true,
					api_ops_id: projectid,
					projectid: projectid
				};
			}

			fs.writeFile(master_upd_filename, JSON.stringify(master_dump), (error) => {
				if (error) {
					console.log(`error: ${error.message}`);
					res.status(500).json({ success: false, message: error });
					db.dropDatabase();
					return;
				}

				mongo_url += '/' + dbname + '?authSource=admin';
				// let cmd = `mongodump --uri='${mongo_url}' --authenticationDatabase=admin --db='${dbname}' --forceTableScan --archive='${dump_db}'`
				let cmd = `mongodump --uri="${mongo_url}" --forceTableScan --archive="${dump_db}"`;
				console.log(cmd);
				exec(cmd, (error, stdout, stderr) => {
					if (error) {
						console.log(`error: ${error.message}`);
						res.status(500).json({
							success: false,
							message: 'Unable to generate package',
							error: error.message
						});
						db.dropDatabase();
						removeLocalStorgae(dump_db);
						removeLocalStorgae(master_upd_filename);
						return;
					}
					if (stderr) {
						console.log(`stderr: ${stderr}`);
					}

					let zip = new AdmZip();
					const outfile = offlinePath + 'proj_datgen_' + projectid.substring(6) + '.zip';

					const shellFileName =
						os_type == 'windows'
							? 'offlinedatagenimport.ps1'
							: 'offlinedatagenimport.sh';
					let shellFile = process.env.DUMP_PATH + shellFileName;
					console.log('shellfilepath', shellFile);

					zip.addLocalFile(master_upd_filename);
					zip.addLocalFile(dump_db);
					zip.addLocalFile(shellFile);
					zip.writeZip(outfile);

					const bucketName = 'ezpai-poc';
					const bucketFolder = 'proj_gen_' + projectid;
					const filepath = outfile;
					const filename = 'proj_dg' + project_data['projectName'] + '_image.zip';

					uploadAndGetSignedURL(bucketName, bucketFolder, filepath, filename)
						.then((value) => {
							res.status(200).json({ downloadUrl: value });
							db.dropDatabase();
							removeLocalStorgae(filepath);
							removeLocalStorgae(dump_db);
							removeLocalStorgae(master_upd_filename);
							console.log('dwnload url value', value);
						})
						.catch((err) => {
							res.status(500).json({ error: err.message });
							db.dropDatabase();
							removeLocalStorgae(filepath);
							removeLocalStorgae(dump_db);
							removeLocalStorgae(master_upd_filename);
						});
				});
			});
		} catch (error) {
			console.log('Some error - ', error);
			db.dropDatabase();
			removeLocalStorgae(filepath);
			removeLocalStorgae(dump_db);
			res.status(400).send({ error: error.message });
		}
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: 'unexpected error' });
	}
});

// Download artefact
router.post('/download_apiops', auth, async (req, res) => {
	let projectid = req.body.projectId;
	let os_type = req.body.os_type ? req.body.os_type : 'others';
	let dbname = null;
	let offlinePath = 'offline/';

	let timeout = 10 * 60 * 1000;
	req.socket.setTimeout(timeout);

	if (!fs.existsSync(offlinePath)) {
		fs.mkdirSync(offlinePath);
	}

	try {
		let project_data = await Projects.findOne({ projectId: projectid });
		let testcase_data = await testcases.find({ projectid: projectid }, { _id: 0 });
		let virtual_data = await virtual.find({ projectid: projectid }, { _id: 0 });
		let sankey_data = await sankey.find({ projectid: projectid }, { _id: 0 });
		let test_result_data = await test_result.find({ projectid: projectid }, { _id: 0 });
		let db_data = await dbdata.find({ projectid: projectid }, { _id: 0 });
		let database_data = await database.findOne({ projectid: projectid });

		dbname = 'proj_db_' + projectid.substring(6);
		const { client, db } = await mongoUtil.connectToServer(dbname);

		if (!project_data) {
			return res.status(404).send({ message: 'Project Not found' });
		}

		let dg_env = aiServerURL.split(':')[0] + ':' + aiServerURL.split(':')[1];

		/* if (aiServerURL.includes("test")){
			dg_env = aiServerURL.split(":")[0]; //"http://test-1.ezapi.ai"
		}  else if(aiServerURL.includes("demo")) {
			dg_env = "http://demo-1.ezapi.ai"
		}  else if(aiServerURL.includes("instance-2")) {
			dg_env = "http://instance-2.ezapi.ai"
		}  */

		try {
			await db.collection('testcases').insertMany(testcase_data);
			await db.collection('virtual').insertMany(virtual_data);
			await db.collection('sankey').insertMany(sankey_data);
			await db.collection('test_result').insertMany(test_result_data);
			if (db_data.length) {
				await db.collection('dbdata').insertMany(db_data);
			}

			let mongo_url = process.env.MONGO_CONNECTION;
			const dump_db = offlinePath + dbname;

			const master_filename = offlinePath + dbname + '.json';
			let master_dump = {};

			if (database_data && project_data['projectType'] != 'schema') {
				master_dump = {
					userid: project_data['author'],
					projectName: project_data['projectName'],
					projectType: project_data['projectType'],
					filename: null,
					dbname: dbname,
					status: true,
					api_ops_id: projectid,
					projectid: projectid,
					type: database_data['type'],
					order: database_data['order'],
					inserted_func: false,
					inserted_perf: false,
					gen_req_completed_perf: true,
					gen_req_completed_func: true,
					dg_chk: dg_env,
					lastGenType: project_data['lastGenType']
				};
			} else {
				master_dump = {
					userid: project_data['author'],
					projectName: project_data['projectName'],
					projectType: project_data['projectType'],
					filename: null,
					dbname: dbname,
					status: true,
					api_ops_id: projectid,
					projectid: projectid,
					inserted_func: false,
					inserted_perf: false,
					dg_chk: dg_env
				};
			}

			try {
				if (project_data['apiSpec']) {
					master_dump['filename'] = project_data['apiSpec'][0]['name'];
				} else {
					master_dump['filename'] = project_data['projectName'];
				}
			} catch (error) {
				console.log("Can't find the filename");
			}

			fs.writeFile(master_filename, JSON.stringify(master_dump), (error) => {
				if (error) {
					console.log(`error: ${error.message}`);
					res.status(500).json({ success: false, message: error });
					db.dropDatabase();
					return;
				}

				mongo_url += '/' + dbname + '?authSource=admin';
				// let cmd = `mongodump --uri='${mongo_url}' --authenticationDatabase=admin --db='${dbname}' --forceTableScan --archive='${dump_db}'`
				let cmd = `mongodump --uri="${mongo_url}" --forceTableScan --archive="${dump_db}"`;
				console.log(cmd);
				exec(cmd, (error, stdout, stderr) => {
					if (error) {
						console.log(`error: ${error.message}`);
						res.status(500).json({
							success: false,
							message: 'Unable to generate package',
							error: error.message
						});
						db.dropDatabase();
						removeLocalStorgae(dump_db);
						removeLocalStorgae(master_filename);
						return;
					}
					if (stderr) {
						console.log(`stderr: ${stderr}`);
						// db.dropDatabase();
						// removeLocalStorgae(dump_db);
						// removeLocalStorgae(master_filename);
						// return;
					}

					let zip = new AdmZip();
					const outfile = offlinePath + 'proj_image_' + projectid.substring(6) + '.zip';
					let grafdb = process.env.DUMP_PATH + 'grafana.db';

					//const shellFileName =
					//os_type == 'windows' ? 'offlinedeploy.ps1' : 'offlinedeploy.sh';
					const shellFileName =
						os_type == 'windows'
							? 'offlinedeploy.ps1'
							: os_type == 'mac'
							? 'offlinedeploym.sh'
							: 'offlinedeploy.sh';
					let shellFile = process.env.DUMP_PATH + shellFileName;
					if (currentdeployenv == 'lower') {
						shellFile = process.env.DUMP_PATH + currentdeployenv + '/' + shellFileName;
						grafdb = process.env.DUMP_PATH + currentdeployenv + '/' + 'grafana.db';
					}
					console.log('shellfilepath', shellFile);

					const constantsFile = process.env.DUMP_PATH + 'Constants.js';

					zip.addLocalFile(master_filename);
					zip.addLocalFile(dump_db);
					zip.addLocalFile(shellFile);
					zip.addLocalFile(constantsFile);
					zip.addLocalFile(grafdb);
					zip.writeZip(outfile);

					const bucketName = 'ezpai-poc';
					const bucketFolder = 'proj_' + projectid;
					const filepath = outfile;
					const filename = 'proj_' + project_data['projectName'] + '_image.zip';

					uploadAndGetSignedURL(bucketName, bucketFolder, filepath, filename)
						.then((value) => {
							res.status(200).json({ downloadUrl: value });
							db.dropDatabase();
							removeLocalStorgae(filepath);
							removeLocalStorgae(dump_db);
							removeLocalStorgae(master_filename);
						})
						.catch((err) => {
							res.status(500).json({ error: err.message });
							db.dropDatabase();
							removeLocalStorgae(filepath);
							removeLocalStorgae(dump_db);
							removeLocalStorgae(master_filename);
						});
				});
			});
		} catch (error) {
			console.log('Some error - ', error);
			db.dropDatabase();
			removeLocalStorgae(filepath);
			removeLocalStorgae(dump_db);
			removeLocalStorgae(master_filename);
			res.status(400).send({ error: error.message });
		}

		// 0. Get Collections Data (filter by projectid)
		// 1. Create New DB
		// 2. Create New Collections
		// 3. Bulk Insert into Collection
		// 4. Download DB Dump
		// 5. Delete Newly Created DB
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: 'unexpected error' });
	}
});

// Download codeGen
router.post('/download_codegen', auth, async (req, res) => {
	try {
		let projectid = req.body.projectId;
		let codepath = '/mnt/codegen/' + projectid + "/javacode";
		let offlinePath = 'offline/';
		let project_data = await Projects.findOne({ projectId: projectid });

		if (!project_data) {
			return res.status(404).send({ message: 'Project Not found' });
		}

		if (!fs.existsSync(codepath)) {
			return res.status(404).send({ error: 'code not found' });
		}

		if (!fs.existsSync(offlinePath)) {
			fs.mkdirSync(offlinePath);
		}

		const outpath = 'offline/' + projectid + '.zip';
		const outfile = fs.createWriteStream(outpath);
		const archive = archiver('zip');

		outfile.on('close', function () {
			console.log(archive.pointer() + ' total bytes');
			console.log('archiver has been finalized and the output file descriptor has closed.');
		});

		archive.on('error', function (err) {
			res.status(500).json({ error: err });
		});

		await archive.pipe(outfile);
		await archive.directory(codepath, false);
		await archive.finalize();

		const bucketName = 'ezpai-poc';
		const bucketFolder = 'proj_' + projectid;
		const filepath = outpath;
		const filename = 'proj_' + project_data['projectName'] + '_code.zip';

		uploadAndGetSignedURL(bucketName, bucketFolder, filepath, filename)
			.then((value) => {
				res.status(200).json({ downloadUrl: value });
				removeLocalStorgae(filepath);
			})
			.catch((err) => {
				res.status(500).json({ error: err.message });
				removeLocalStorgae(filepath);
			});
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: 'unexpected error' });
	}
});

// Download dotnet codeGen
router.post('/download_dotnet_codegen', auth, async (req, res) => {
	try {
		let projectid = req.body.projectId;
		let project_data = await Projects.findOne({ projectId: projectid });
		let projectName = project_data['projectName'].replace("_", "").replace("-","")
		console.log(projectName)
		let codepath = '/mnt/codegen/' + projectid + "/dotnetcode/"+projectName;
		let offlinePath = 'offline/';
		
		if (!project_data) {
			return res.status(404).send({ message: 'Project Not found' });
		}

		if (!fs.existsSync(codepath)) {
			return res.status(404).send({ error: 'code not found' });
		}

		if (!fs.existsSync(offlinePath)) {
			fs.mkdirSync(offlinePath);
		}

		const outpath = 'offline/' + projectid + '_dotnet.zip';
		const outfile = fs.createWriteStream(outpath);
		const archive = archiver('zip');

		outfile.on('close', function () {
			console.log(archive.pointer() + ' total bytes');
			console.log('archiver has been finalized and the output file descriptor has closed.');
		});

		archive.on('error', function (err) {
			res.status(500).json({ error: err });
		});

		await archive.pipe(outfile);
		await archive.directory(codepath, false);
		await archive.finalize();

		const bucketName = 'ezpai-poc';
		const bucketFolder = 'proj_' + projectid;
		const filepath = outpath;
		const filename = 'proj_' + projectName + '_dotnetcode.zip';

		uploadAndGetSignedURL(bucketName, bucketFolder, filepath, filename)
			.then((value) => {
				res.status(200).json({ downloadUrl: value });
				removeLocalStorgae(filepath);
			})
			.catch((err) => {
				res.status(500).json({ error: err.message });
				removeLocalStorgae(filepath);
			});
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: 'unexpected error' });
	}
});

module.exports = router;
