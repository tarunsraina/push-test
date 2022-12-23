// **********copyright info*****************************************
// This code is copyright of EZAPI LLC. For further info, reach out to rams@ezapi.ai
// *****************************************************************

const express = require('express')

const apiopsMiddleware = require('../middlewares/apiops')
const downloadController = require('../controllers/downloadController')

// const linkedinMiddleware = require('../authentication/validateLinkedinToken')
// const authorizationMiddleware = require('../authentication/authorization')

const router = express.Router();

router
    .route('/download')
    .get(apiopsMiddleware.getDbName, downloadController.downloadImage)
// .get(
//     linkedinMiddleware.ValidateLinkedinToken,
//     authorizationMiddleware.authorization,
//     apiopsMiddleware.checkUser,
//     downloadController.downloadImage)
// )

module.exports = router;