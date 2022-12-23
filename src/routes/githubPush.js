let GitHub = require('github-api');
let fs = require('fs');
const express = require('express');
const router = new express.Router();
const path = require('path');
const { default: axios } = require('axios');
const githubUserData = require('../models/githubUserData');
const Projects = require('../models/projects')

router.post('/push_to_github',async(req,res)=>{

    let branchName = req.body.branch;
    let userName = req.body.username;
    let directory = req.body.directory;
    let repoName = req.body.reponame;
    let projectId = req.body.projectid;
    let token = req.headers['authorization'] || req.headers['x-access-token'];

     if(!token){
        // missing token
        return res.sendStatus(401);
      }

      if(!(branchName&&userName&&directory&&repoName&&projectId)){
        return res.sendStatus(400);
      }

      const query = { $and: [{ projectId: projectId }, { isDeleted: false }] };
	  const project = await Projects.findOne(query);

      if (!project) {
        return res.status(404).send({ error:"PROJECT_NOT_FOUND" });
    }

      // For this library to work , we atleast need one commit , so committing a welcome.txt file

    const options1 = {
        method: 'POST',
        url: `https://api.github.com/repos/${userName}/${repoName}/contents/welcome.txt`,
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
        },
        data:
        {
            "message":"sample commit",
            "committer":{
                "name":"Tarun",
                "email":"tarun.t@cumulations.com"
                },
            "content":"V2VsY29tZSB0byBDb25la3R0byEK"  // 'welcome to connektto' in base64 encoded version
        }
    };

    axios
    .request(options1)
    .then(function (response) {
        console.log(response.data);
    })
    .catch(function (error) {
        console.error(error);
    });

        function flatten(lists) {
            return lists.reduce((a, b) => a.concat(b), []);
        }
    
        function getDirectories(srcpath) {
            return fs.readdirSync(srcpath)
                .map(file => path.join(srcpath, file))
                .filter(path => fs.statSync(path).isDirectory());
        }
    
        function getDirectoriesRecursive(srcpath) {
            return [srcpath, ...flatten(getDirectories(srcpath).map(getDirectoriesRecursive))];
        }
    
    
    let allDirs = getDirectoriesRecursive(directory)
    let filePaths = []
    for(let i=0;i<allDirs.length;i++){
    
      if(!String(allDirs[i]).includes("git")){ 
        filePaths.push(String(allDirs[i]).replace(/\\/g, "/"));
      }
    }

    /*

    // INITIAL HARDCODED JAVA DIRS
    
    let javaDirectories = [
    
        "proj_P7_code",
        "proj_P7_code/src/main/docker/grafana/provisioning/dashboards",
        "proj_P7_code/src/test/java/com/ezapi/api/repository/timezone",
        "proj_P7_code/src/main/docker",
        "proj_P7_code/src/main/docker/prometheus",
        "proj_P7_code/src/main/java/com/ezapi/api/aop/logging",
        "proj_P7_code/src/main/java/com/ezapi/api/client",
        "proj_P7_code/src/main/java/com/ezapi/api/config",
        "proj_P7_code/src/main/java/com/ezapi/api/domain",
        "proj_P7_code/src/main/java/com/ezapi/api/security",
        "proj_P7_code/src/main/java/com/ezapi/api/security/jwt",
        'proj_P7_code/src/main/java/com/ezapi/api/service',
        "proj_P7_code/src/main/java/com/ezapi/api/service/mapper",
        "proj_P7_code/src/main/java/com/ezapi/api/repository",
        "proj_P7_code/src/main/java/com/ezapi/api/service/dto",
        "proj_P7_code/src/main/java/com/ezapi/api",
        "proj_P7_code/src/main/resources/config/liquibase/fake-data",
        "proj_P7_code/src/main/java/com/ezapi/api/web/rest/vm",
        "proj_P7_code/src/main/resources/config/liquibase/changelog",
        "proj_P7_code/src/main/resources",
        "proj_P7_code/src/main/docker/grafana/provisioning/datasources", //done
        "proj_P7_code/src/test/java/com/ezapi/api/service/mapper",
        "proj_P7_code/src/main/resources/config",
        "proj_P7_code/src/main/docker/jib",
        "proj_P7_code/src/main/resources/config/liquibase",
        "proj_P7_code/src/main/java/com/ezapi/api/web/rest/errors",
        "proj_P7_code/src/main/java/com/ezapi/api/service/impl",
        "proj_P7_code/src/main/resources/config/tls",
        "proj_P7_code/src/main/resources/i18n",
        'proj_P7_code/src/test/java/com/ezapi/api/security/jwt',
        "proj_P7_code/src/main/resources/static",
        "proj_P7_code/src/main/resources",
        "proj_P7_code/src/main/java/com/ezapi/api/web/rest",
        "proj_P7_code/src/main/resources/templates",
        "proj_P7_code/src/test/java/com/ezapi/api",
        'proj_P7_code/src/test/java/com/ezapi/api/config',
        "proj_P7_code/src/test/java/com/ezapi/api/config/timezone",
        "proj_P7_code/src/test/java/com/ezapi/api/domain",
        "proj_P7_code/src/test/java/com/ezapi/api/security",
        "proj_P7_code/src/test/java/com/ezapi/api/service/dto",
        "proj_P7_code/src/test/java/com/ezapi/api/web/rest",
        "proj_P7_code/src/test/java/com/ezapi/api/web/rest/errors",
        'proj_P7_code/src/test/resources',
        "proj_P7_code/src/test/resources/config",
        
    ]
    */
    
    
      for(let file=0;file<filePaths.length;file++){
        pushFilesFromDirectory(filePaths[file])
        await delay(4000) // to avoid merge conflicts
      }

      function delay(time) {
          return new Promise(resolve => setTimeout(resolve, time));
      }
    
    function pushFilesFromDirectory(dirName) {
    let filenames;
    let directory_name = dirName;
    try{
        filenames = fs.readdirSync(directory_name);
    }catch(e){
        console.log(e.message)
        return;
    }
    let directories = [];
    let files = [];
    
    filenames.forEach((file) => {  
        try{
            content = fs.readFileSync(directory_name+"/"+file);
            files.push(file);
        }
        catch(e){
            directories.push(file);
        }
        
    });

    
    // making them globally available

    let fileContentObj = [];
    let content;
    let filePath;
    
    for(let i=0;i<directories.length;i++){
        filePath = directory_name+"/"+directories[i];
        try{
        content = fs.readFileSync(filePath).toString();
        }catch(e){
            console.log("Skipping a directory if found");
        }
        let obj = {
            content : content,
            path : filePath
        }
        if(filePath.endsWith("src")||filePath.endsWith(".git")||typeof(content)=='undefined'){
            continue; // filepath malformation fix
        }
        fileContentObj.push(obj);

    }
    let api = new GithubAPI({token:token});
    api.setRepo(userName,repoName)
    api.setBranch(branchName)
    .then( () => {
        api.pushFiles('pushing files from API',fileContentObj)
    })
    .then(function() {console.log('Files committed!');});
    }
    
    function GithubAPI(auth) {
        let repo;
        let filesToCommit = [];
        let currentBranch = {};
        let newCommit = {};
    
    
    this.gh = new GitHub(auth);
    
    this.setRepo = function() {}
    this.setBranch = function() {}
    this.pushFiles = function() {}
    function getCurrentCommitSHA() {}    
    function getCurrentTreeSHA() {}   
    function createFiles() {}  
    function createFile() {}   
    function createTree() {}  
    function createCommit() {}   
    function updateHead() {}
    
    this.setRepo = function(userName, repoName){    
        repo = this.gh.getRepo(userName, repoName);
    }
    
    this.setBranch = function(branchName) {   
        return repo.listBranches()        
        .then((branches) => {
            let branchExists = branches.data    
            .find( branch => branch.name === branchName );
            if (!branchExists) {
                return repo.createBranch('master', branchName)
                .then(() => {
                    currentBranch.name = branchName;
                });
            } else {
                currentBranch.name = branchName;
            }
        });
    }
    
    
        this.pushFiles = function(message, files) {
            return getCurrentCommitSHA()
        
        .then(getCurrentTreeSHA)  
        .then( () => createFiles(files) )
        .then(createTree)
        .then( () => createCommit(message) )        
        .then(updateHead)        
        .catch((e) => {console.error(e);});
    }
    
    
    
    function getCurrentCommitSHA() {
        return repo.getRef('heads/' + currentBranch.name)
        .then((ref) => { 
            currentBranch.commitSHA = ref.data.object.sha;        
        });
    }
    
    
    function getCurrentTreeSHA() {
           return repo.getCommit(currentBranch.commitSHA)        
           .then((commit) => {
            currentBranch.treeSHA = commit.data.tree.sha;
        });
    }
    
    function createFiles(files) {    
        let promises = [];    
        let length = files.length; 
    
        for (let i = 0; i < length; i++) {
          promises.push(createFile(files[i]));
        }
        return Promise.all(promises);
    
    }
    
    function createFile(file) {    
        return repo.createBlob(file.content)        
        .then((blob) => {            
            filesToCommit.push({
                sha: blob.data.sha,
                path: file.path,
                mode: '100644',
                type: 'blob'
            });        
        });
    }
    
    
    function createTree() { 
        return repo.createTree(filesToCommit, currentBranch.treeSHA)        
        .then((tree) => {  
            newCommit.treeSHA = tree.data.sha; 
        });
    }
    
    function createCommit(message) { 
        return repo.commit(currentBranch.commitSHA, newCommit.treeSHA, message)       
        .then((commit) => { 
            newCommit.sha = commit.data.sha;     
        });
    }
    
    function updateHead() {    
        return repo.updateHead('heads/' + currentBranch.name,newCommit.sha);
        }
    }

    await Projects.updateOne({ projectId: projectId},{"$set":{salary:1000,something:200}})

            // first push case
            let  githubPushDetails = { userName : userName, repoName :repoName,branchName:branchName };
            Projects.findOneAndUpdate(
            { projectId : projectId }, 
            { $push: { githubPushData : githubPushDetails } },
            function (error, success) {
                    if (error) {
                        console.log(error);
                    } else {
                        console.log(success);
                    }
            });
            /*
            const prevGitPushData = project.githubPushData ? project.githubPushData : [];
			project.resources = [...prevGitPushData, { userName : userName, repoName :repoName,branchName:branchName }];
			await project.save();
            */

    res.send("PUSHED TO GITHUB");
    
})

router.post('/create_branch',async(req,res)=>{

    let userName = req.body.username;
    let repoName = req.body.reponame;
    let branchName = req.body.branch;

    let token = req.headers['authorization'] || req.headers['x-access-token'];

    // For this library to work , we atleast need one commit , so committing a welcome.txt file

    const options1 = {
        method: 'POST',
        url: `https://api.github.com/repos/${userName}/${repoName}/contents/welcome.txt`,
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
        },
        data:
        {
            "message":"sample commit",
            "committer":{
                "name":"Tarun",
                "email":"tarun.t@cumulations.com"
                },
            "content":"V2VsY29tZSB0byBDb25la3R0byEK"  // 'welcome to connektto' in base64 encoded version
        }
    };

    axios
    .request(options1)
    .then(function (response) {
        console.log(response.data);
    })
    .catch(function (error) {
        console.error(error);
    });

    if(!token){
        return res.send(401);
    }

    if(!(userName&&repoName)){
        return res.send(400);
    }

    let response = await axios
    .get(`https://api.github.com/repos/${userName}/${repoName}/git/refs/heads`)
    .then((res) => res.data)
	.catch((error) => {
		throw error;
	});

    let branchHash = response[0].object.sha;

    const options = {
        method: 'POST',
        url: `https://api.github.com/repos/${userName}/${repoName}/git/refs`,
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
        },
        data:
            {
                "ref":`refs/heads/${branchName}`,
                "sha": branchHash
            }
    };

    axios
    .request(options)
    .then(function (response) {
        console.log(response.data);
    })
    .catch(function (error) {
        console.error(error);
    });

    res.send("branch created successfully")

})

router.post('/create_repo',(req,res)=>{

    let repoName = req.body.reponame;
    let description = req.body.description;
    let token = req.headers['authorization'] || req.headers['x-access-token'];

    if(!token){
        return res.sendStatus(401);
    }

    if(!(repoName&&description)){
        return res.sendStatus(400);
    }

    const options = {
        method: 'POST',
        url: `https://api.github.com/user/repos`,
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
        },
        data:
        {
            "name":repoName,
            "description":description,
            "homepage":"https://github.com",
            "private":false,
            "is_template":false
        }
    };

    axios
    .request(options)
    .then(function (response) {
        console.log(response.data);
    })
    .catch(function (error) {
        console.error(error);
    });

    res.send("Repo created successfully")

})

router.post('/view_repo',(req,res)=>{
    
    let userName = req.body.username;
    let repoName = req.body.reponame;
    let token = req.headers['authorization'] || req.headers['x-access-token'];

    if(!token){
        return res.sendStatus(401);
    }

    if(!(repoName&&userName)){
        return res.sendStatus(400);
    }

    const options = {
        method: 'POST',
        url: `https://api.github.com/repos/${userName}/${repoName}`,
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
        },
        data:
        {
            "reponame":repoName,
            "username":userName
        }
    };

    axios
    .request(options)
    .then(function (response) {
        let html_url = response.data.html_url;
        return res.send({html_url : html_url});
    })
    .catch(function (error) {
        console.error(error);
        return res.sendStatus(500);
    });


})

router.post('/github_auth_token',async(req,res)=>{
    
    let code = req.body.code;

    let github_access_token;

    if(!code){
        return res.sendStatus(401);
    }
    
    const options = {
        method: 'POST',
        // client ID and client SECRET are hardcoded for now for testing, using from env file later
        url: `https://github.com/login/oauth/access_token?client_id=5d1d5dfe113cdee9b700&client_secret=7d95d7f719ea1146474a72887357dd451551adde&code=${code}`,
        headers: {
            'Accept': 'application/vnd.github+json'
        },
        data:
        {
            "code":code
        }
    };

    await axios
    .request(options)
    .then(function (response) {
        github_access_token = response.data.access_token;
        
    })
    .catch(function (error) {
        console.error(error);
        return res.sendStatus(500);
    });


    const options1 = {
        method: 'GET',
        url: `https://api.github.com/user`,
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization':`Bearer ${github_access_token}`
        }
    };

    await axios
    .request(options1)
    .then(async function (response) {
        //console.log("response:")
        let userName = response.data.login;
        let email = response.data.email;

        if(!github_access_token){
            return res.sendStatus(401);
        }else{

            // mongo updation/insertion code , keeping for future ref
            /*
                console.log("ooooooooo")
                githubUserData.exists({userName:userName},(err,exists)=>{
                    console.log(exists)
                    if(exists){
                        // update the accessToken
                        githubUserData.updateOne({userName:userName},{ "$set": { "accessToken": github_access_token } },(err,updatedResult)=>{
                            if(err){
                                console.log(err);
                            }
                        })
                    }else{
                        let githubUser = new githubUserData({userName:userName,email:email,accessToken:github_access_token})
                        githubUser.save();
                    }
                })
            */

            return res.send({username : userName , email : email , access_token : github_access_token })
        }

    })
    .catch(function (error) {
        // console.error(error);
        return res.sendStatus(500);
    });

})

module.exports = router;

