const express = require('express');
const auth = require('../authentication/authorization');
const shortid = require('shortid');
const request = require('request');
const { sendEmail, sendEmail2 } = require('../services/mailing');
const path = require('path');

const User = require('../models/user');
const Project = require('../models/projects');
const router = new express.Router();
const { getFormattedUtcDateTime } = require('../utility/utilities');

const WorkOS = require('@workos-inc/node').default;
const workos = new WorkOS(process.env.WORKOS_API_KEY);
//const organization = process.env.ORGANIZATION_ID;
// Set the redirect URI to whatever URL the end user should land on post-authentication.
// Ensure that the redirect URI you use is included in your allowlist in the WorkOS Dashboard.
const redirectURI = process.env.WORKOS_REDIRECT_URI;
const clientID = process.env.WORKOS_CLIENT_ID;
const getOrgID = require('../controllers/getOrgIDController');

const aiServerURL = process.env.AI_SERVER_URL;
let hostPath = aiServerURL.replace(':5000', '');
let shardInbxEmailId = process.env.SHAREDINBOX_EMAILID;
const currentdeployenv = process.env.DEPLOYMENT_ENV;
if (hostPath.includes('instance-2')) {
	hostPath = hostPath.replace('instance-2', 'www');
}
hostPath = hostPath.replace('http', 'https');

router.post('/auth', async (req, res) => {
	if (!req.body.code) {
		res.status(400).send('No auth code found!');
	}
	if (!req.body.redirect_uri) {
		res.status(400).send('No redirect_uri found!');
	}
	//console.log("...",req.body.redirect_uri);
	request.post(
		{
			url: 'https://www.linkedin.com/oauth/v2/accessToken',
			form: {
				grant_type: 'authorization_code',
				code: req.body.code,
				redirect_uri: req.body.redirect_uri,
				client_id: process.env.CLIENT_ID,
				client_secret: process.env.CLIENT_SECRET
			}
		},
		async function (err, res2, responseBody) {
			if (err) {
				res.status(400).send(err);
				return;
			}

			const llToken = JSON.parse(responseBody);

			if (llToken && !llToken.access_token) {
				res.status(400).send(responseBody);
				return;
			}

			try {
				const profileData = await getLinkedinProfile(llToken.access_token);
				const emailData = await getLinkedinEmail(llToken.access_token);
				const emailId = emailData.elements[0]['handle~']['emailAddress'];

				//console.log('profileData == ', profileData);
				//console.log('emailData == ', emailId);
				// res.status(201).json({ data: profileData, emailData });

				// check user exists then update
				let user = await User.findOne({ linkedinID: profileData.id });

				if (user) {
					// console.log('user already added');
					user.linkedinToken = llToken.access_token;
					user.expiresOn = new Date().setSeconds(llToken.expires_in);
					user.lastLogin = getFormattedUtcDateTime();

					let invitedData = await sendRegNotif(
						emailId,
						getFormattedUtcDateTime(),
						profileData.localizedFirstName,
						'old',
						currentdeployenv
					);
				} else {
					user = await User.findOne({ email: emailId });
					if (user) {
						//if user email id already exists (via workos)
						user.linkedinToken = llToken.access_token;
						user.expiresOn = new Date().setSeconds(llToken.expires_in);
						user.lastLogin = getFormattedUtcDateTime();
						//user.firstName = profileData.localizedFirstName;
						//user.lastName = profileData.localizedLastName;
						user.linkedinID = profileData.id;
					} else {
						//register new user
						const userData = {
							firstName: profileData.localizedFirstName,
							lastName: profileData.localizedLastName,
							email: emailId,
							linkedinID: profileData.id,
							linkedinToken: llToken.access_token,
							expiresOn: new Date().setSeconds(llToken.expires_in), //save timestamp
							user_id: shortid.generate(),
							registeredOn: getFormattedUtcDateTime()
						};
						user = User(userData);
						await acceptProjectInvites(user);

						let invitedData = await sendRegNotif(
							emailId,
							getFormattedUtcDateTime(),
							profileData.localizedFirstName,
							'new',
							currentdeployenv
						);

						let welcomeData = await sendRegNotif(
							emailId,
							getFormattedUtcDateTime(),
							profileData.localizedFirstName,
							'welcome',
							currentdeployenv
						);
					}
				}
				const jwtToken = await user.generateJwt();
				await user.save();
				//console.log("invitedData started",emailId );
				/* let invitedData = await sendRegNotif(
					emailId,
					getFormattedUtcDateTime(),
					profileData.localizedFirstName,
					"new"
				); */
				//console.log("invitedData..", invitedData);

				res.status(201).send({ jwtToken, userData: user.getPublicProfile() });
			} catch (error) {
				res.status(400).send(error);
			}
		}
	);
});

router.post('/sso_url', async (req, res) => {
	try {
		const email = req.body.email;
		const domain = email.substring(email.indexOf('@') + 1);
		const { orgId, error } = await getOrgID(domain);

		if (error) {
			return res.status(400).send({ error: error });
		} else {
			const url = workos.sso.getAuthorizationURL({
				organization: orgId,
				redirectURI,
				clientID
			});

			res.set('Access-Control-Allow-Origin', '*');
			res.status(201).send({ url: url });
		}
	} catch (error) {
		res.status(400).send({ message: 'SSO Authorization Error!', error: error });
	}
});

router.post('/auth_workos', async (req, res) => {
	if (!req.body.code) {
		res.status(400).send({ message: 'No auth code found!' });
	}
	try {
		// Capture and save the `code` passed as a querystring in the Redirect URI.
		const { code } = req.body;
		//console.log(code);

		// This will return a JSON user profile, stored here in `profile`.
		const { profile, access_token, expires_in } = await workos.sso.getProfileAndToken({
			code,
			clientID
		});

		try {
			// check user exists then update
			let user = await User.findOne({ ssoID: profile.id });

			//getting the organization name
			const orgid = profile.organization_id;
			const orgs = await workos.organizations.listOrganizations({});
			const orgname = orgs.data.find((ob) => ob.id === orgid).name;
			console.log('profile object', profile);

			if (user) {
				// console.log('user already added');
				user.ssoToken = access_token;
				user.expiresOn = new Date().setSeconds(expires_in);
				user.lastLogin = getFormattedUtcDateTime();

				let invitedData = await sendRegNotif(
					profile.email,
					getFormattedUtcDateTime(),
					profile.first_name,
					'old',
					currentdeployenv
				);
			} else {
				user = await User.findOne({ email: profile.email });
				if (user) {
					//if user email id already exists (via linkedin)
					user.ssoToken = access_token;
					user.expiresOn = new Date().setSeconds(expires_in);
					user.lastLogin = getFormattedUtcDateTime();
					//user.firstName = profile.first_name;
					//user.lastName = profile.last_name;
					user.ssoID = profile.id;
					user.connection_type = profile.connection_type;
					user.organization_id = profile.organization_id;
					user.organization_name = orgname;
					user.connection_id = profile.connection_id;
				} else {
					//register new user
					const userData = {
						firstName: profile.first_name,
						lastName: profile.last_name,
						email: profile.email,
						ssoID: profile.id,
						ssoToken: access_token,
						expiresOn: new Date().setSeconds(expires_in),
						user_id: shortid.generate(),
						registeredOn: getFormattedUtcDateTime(),
						connection_type: profile.connection_type,
						organization_id: profile.organization_id,
						organization_name: orgname,
						connection_id: profile.connection_id
					};
					user = User(userData);
					await acceptProjectInvites(user);

					let invitedData = await sendRegNotif(
						profile.email,
						getFormattedUtcDateTime(),
						profile.first_name,
						'new',
						currentdeployenv
					);

					let welcomeData = await sendRegNotif(
						profile.email,
						getFormattedUtcDateTime(),
						profile.first_name,
						'welcome',
						currentdeployenv
					);
				}
			}
			const jwtToken = await user.generateJwt();
			await user.save();
			//console.log("invitedData started",emailId );
			/* let invitedData = await sendRegNotif(
				emailId,
				getFormattedUtcDateTime(),
				profileData.localizedFirstName,
				"new"
			); */
			//console.log("invitedData..", invitedData);

			res.status(201).send({ jwtToken, userData: user.getPublicProfile() });
		} catch (error) {
			return res.status(400).send({ message: error });
		}
	} catch (error) {
		res.status(400).send({ message: error });
	}
});

router.post('/logout', auth, async (req, res) => {
	try {
		//console.log('logging out');
		const user = req.user;

		// Remove expired all tokens
		let validTokens = user.tokens.filter((item) => {
			let isValid = checkValidToken(item);
			return isValid;
		});

		// Remove current token
		user.tokens = validTokens.filter((item) => {
			return item !== req.token;
		});

		await req.user.save();
		res.send('User Logged out.');
	} catch (error) {
		res.status(500);
	}
});

const { checkValidToken } = require('../authentication/authUtil');
router.post('/logoutAll', auth, async (req, res) => {
	try {
		console.log('logging out all');
		const user = req.user;

		let legitTokens = user.tokens.filter((item) => {
			let isValid = checkValidToken(item);
			return isValid;
		});

		user.tokens = legitTokens;
		await user.save();

		res.send({ message: 'logout success' });
	} catch (error) {
		res.status(500);
	}
});

function getLinkedinProfile(accessToken) {
	return new Promise((resolve, reject) => {
		var options = {
			url: 'https://api.linkedin.com/v2/me',
			method: 'GET',
			headers: {
				Host: 'api.linkedin.com',
				Connection: 'Keep-Alive',
				Authorization: 'Bearer ' + accessToken
			},

			json: true // Automatically stringifies the body to JSON
		};

		request(options, (err, response, body) => {
			if (err) {
				reject('err=>', err);
			}
			resolve(body);
		});
	});
}

function getLinkedinEmail(accessToken) {
	return new Promise((resolve, reject) => {
		var options = {
			url: 'https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))',
			method: 'GET',
			headers: {
				Host: 'api.linkedin.com',
				Connection: 'Keep-Alive',
				Authorization: 'Bearer ' + accessToken
			},
			json: true // Automatically stringifies the body to JSON
		};

		request(options, (err, response, body) => {
			if (err) {
				reject('err=>', err);
			}
			resolve(body);
		});
	});
}

async function acceptProjectInvites(user) {
	await Project.updateMany(
		{ 'members.email': user.email },
		{ $set: { 'members.$.accepted': true, 'members.$.user': user.user_id } }
	).then(
		(result) => {
			console.log({ acceptedInvites: result });
		},
		(e) => {
			console.log({ acceptedInvitesError: e });
		}
	);
}

async function sendRegNotif(
	email,
	registeredOn = '',
	userFullName = '',
	userType = '',
	currEnv = ''
) {
	//let user = await User.findOne({ email });
	let invitedData = {};
	let userList = await User.countDocuments();

	if (userType == 'old') {
		toMail = shardInbxEmailId;
		subjectTxt = 'userAnalytics';
		subText = `\nExisting user login:
		\nType |Existing user|
		\nUser Name |${userFullName}|
		\nEmailId |${email}|
		\nRegistered on |${registeredOn}|
		\nat the portal ${hostPath}. 
		\nTotal Registered users now are ${userList}
		\nThanks.`;
	} else if (userType == 'new') {
		toMail = shardInbxEmailId;
		subjectTxt = 'userAnalytics';
		subText = `\nNew user Registration:
		\nType |New User|
		\nUser Name |${userFullName}|
		\nEmailId |${email}|
		\nRegistered on |${registeredOn}|
		\nat the portal ${hostPath}.
		\nTotal Registered users now are ${userList} 
		\nThanks.`;
	} else {
		toMail = email;
		subjectTxt = 'Welcome to Conektto.io';
		console.log('proceeding to sending welcome email');
	}

	const mailOptions = {
		from: `EZAPI <admin@conektto.io>`,
		to: toMail,
		//subject: 'New User Registration',
		subject: subjectTxt,
		//text: `A new user |${userFullName}| with emailId #${email}#, is registered on %${registeredOn}% at the portal ${hostPath}. \nTotal Registered users now are ${userList} \n\nThanks.`
		text: subText
	};
	const mailOptions2 = {
		from: `EZAPI <admin@conektto.io>`,
		to: toMail,
		//subject: 'New User Registration',
		subject: subjectTxt,
		//text: `A new user |${userFullName}| with emailId #${email}#, is registered on %${registeredOn}% at the portal ${hostPath}. \nTotal Registered users now are ${userList} \n\nThanks.`
		html: "Hi there, <br> <br> Amol Dewhare (Co-Founder & CPO) and Ram Sathia (Co-Founder & CTO) cordially welcome you on board to Conektto. Weâre excited to have you here. <br> <br> Conekttoâs API lifecycle fabric gives you complete package of RestAPI artifacts, auto generated from a design. Connect to your database, collaborate with your stakeholders, design your API and instantly generate API specification, visualization, mocks, source code, test data, functional and performance test execution suites. <br><br> Get started by following our platform introduction tour: <br> <br> <b><a href ='https://www.youtube.com/watch?v=DFsgbM8mRp8' style='color: #c72c71'>Conektto tour,</a></b> <br> <b><a href = 'https://www.youtube.com/watch?v=qIzj8C7SUoI' style='color: #c72c71'>API lifecycle fabric design &</a></b> <br> <b><a href ='https://www.youtube.com/watch?v=7OlHa3xkj5s' style='color: #c72c71'> Downloadable API workspace.</a></b> <br><br> <p>You can reach out to our Team of Experts <a href = 'mailto:engage@conektto.io'>engage@conektto.io</a> or follow us on twitter <a href='https://twitter.com/conektto?ref_src=twsrc%5Etfw' class='twitter-follow-button' data-show-count='false'> @conektto </a> <script async src='https://platform.twitter.com/widgets.js' charset='utf-8'></script> </p> <br><br> Thank You, <br> Ram & Amol <br> <img style='width:100px;' src='cid:F90RF8121981zgS'/> <br> _______________________________________________________________________________________________________________________ <b><p>Need assistance? Reach out to our <a href = 'mailto:engage@conektto.io?subject=Need%20Help' style='color: #c72c71'> support team </a>. </p> </b>",
		//<a href="https://twitter.com/conektto?ref_src=twsrc%5Etfw" class="twitter-follow-button" data-show-count="false">Follow @conektto</a><script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>

		attachments: [
			{
				filename: 'Logo_Conektto.png',
				path: `${__dirname}/logos/Logo_Conektto.png`,
				cid: 'F90RF8121981zgS' //same cid value as in the html img src
			}
		]
	};

	if (userType == 'welcome') {
		//console.log("__dirname,,", __dirname)
		sendEmail2(mailOptions2);
	} else {
		if (currEnv == 'production') {
			sendEmail(mailOptions);
		}
	}

	/* if (user) {
		invitedData = { email: email, user: user.user_id, accepted: true };
	} else {
		invitedData = { email: email };
	} */
	invitedData = { email: email };

	return invitedData;
}

router.post('/authfake', async (req, res) => {
	//return res.json('success');
	if (!req.body.email) {
		return res.status(400).send('No auth email found!');
	}
	console.log(req.body.email);
	const user = await User.findOne({ email: req.body.email });
	console.log('User is', user);
	if (!user) {
		return res.status(404).send({ err: 'no user!' });
	}
	const jwtToken = await user.generateJwt();
	await user.save();
	res.status(201).send({ jwtToken, userData: user.getPublicProfile() });
});

module.exports = router;
