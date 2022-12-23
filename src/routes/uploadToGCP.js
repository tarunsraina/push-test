const { format } = require('util');
const express = require('express');
const path = require('path');
const Multer = require('multer');

const router = express.Router();

const { Storage } = require('@google-cloud/storage');

// Instantiate a storage client
const storage = new Storage({
	//keyFilename: 'creds2.json',
	keyFilename: path.join(__dirname, '../../creds2.json'),
	projectId: 'civic-access-286104'
});

const multer = Multer({
	storage: Multer.memoryStorage(),
	limits: {
		fileSize: 5 * 1024 * 1024 // no larger than 5mb, you can change as needed.
	}
});

router.use(express.json());

// Process the file upload and upload to Google Cloud Storage.
router.post('/projects/:id/upload_To_GCP', multer.single('upload'), (req, res, next) => {
	if (!req.file) {
		res.status(400).send('No file uploaded.');
		return;
	}

	// A bucket is a container for objects (files).
	const bucket = storage.bucket('upload-files-ezapi');
	const bucketFolder = req.body.userid;

	const projectId = req.params.id;
	const timestamp = Date.now();
	const filename = `${projectId}_${timestamp}_${req.file.originalname}`;
	console.log(filename);

	const filepath = `${bucketFolder}/${filename}`;

	// Create a new blob in the bucket and upload the file data.
	const blob = bucket.file(filepath);

	const blobStream = blob.createWriteStream();

	const test = req.body.test;

	blobStream.on('error', (err) => {
		next(err);
	});

	blobStream.on('finish', () => {
		//The public URL can be used to directly access the file via HTTP.
		// const publicUrl = format(`https://storage.googleapis.com/${bucket.name}/${blob.name}`);

		async function generateV4ReadSignedUrl() {
			// These options will allow temporary read access to the file
			const options = {
				version: 'v4',
				action: 'read',
				expires: Date.now() + 15 * 60 * 1000 // 15 minutes
			};

			// Get a v4 signed URL for reading the file
			const [url] = await storage
				.bucket('upload-files-ezapi')
				.file(filepath)
				.getSignedUrl(options);
			res.status(200).json({ test: test, url: url });
		}
		generateV4ReadSignedUrl();
	});

	blobStream.end(req.file.buffer);
});

module.exports = router;
