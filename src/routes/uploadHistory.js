// **********copyright info*****************************************
// This code is copyright of EZAPI LLC. For further info, reach out to rams@ezapi.ai
// *****************************************************************

const express = require('express')

const uploadController = require('../controllers/uploadController')
const authrization = require('../authentication/authorization');
const validateLinkedinToken = require('../authentication/validateLinkedinToken');
const router = express.Router();

router
    .route('/upload_history')
    .get(validateLinkedinToken, authrization, uploadController.getUploadHistory)

router
    .route('/offline_upload_history')
    .get(uploadController.getUploadHistory)

module.exports = router;