const express = require('express');
const router = new express.Router();

const ProductVideos = require('../models/productVideos');

router.get('/productVideos', async (req, res) => {
	try {
		const productVideos = await ProductVideos.find({}).lean();
		if (productVideos && productVideos.length) {
			return res.status(200).json({ productVideos });
		}
	} catch (err) {
		return res.status(400).json({ error: err.message });
	}
});

module.exports = router;
