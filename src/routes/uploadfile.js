// **********copyright info*****************************************
// This code is copyright of EZAPI LLC. For further info, reach out to rams@ezapi.ai
// *****************************************************************

const express = require('express')

const fileController = require('../controllers/fileController')
const authrization = require('../authentication/authorization');
const validateLinkedinToken = require('../authentication/validateLinkedinToken');

const router = express.Router();

// mutler - file storage code
// Reference - https://github.com/expressjs/multer/issues/439#issuecomment-276255945
const multer = require('multer')
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, process.env.FILE_UPLOAD_PATH)
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname)
    }
})
const upload = multer({ storage: storage })

router
    .route('/upload_file')
    .post(validateLinkedinToken, authrization, upload.single("file"), fileController.parseFileData)

//router.post('/upload_file', validateLinkedinToken, authrization, upload.single("file"), fileController.parseFileData);

module.exports = router;