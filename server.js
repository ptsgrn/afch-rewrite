// Serves the script from localhost for development purposes.

const https = require('https');
const fs = require('fs');

const argv = require('minimist')(process.argv);

// find the certs
const DEFAULT_CERT_FILE = 'certificates/localhost.crt';
if (!argv.cert && !fs.existsSync(DEFAULT_CERT_FILE)) {
	console.error(`Error! Certificate file not found at ${DEFAULT_CERT_FILE}. You probably should run "npm run generate-certificates" (no quotes).`);
	process.exit(0);
}

const keyFile = argv.key || 'certificates/localhost.key';
const certFile = argv.cert || 'certificates/localhost.crt';

const options = {
	key: fs.readFileSync(keyFile),
	cert: fs.readFileSync(certFile)
};

// check that the main file exists
if (!fs.existsSync("build/afch.js")) {
	console.error("Error! Could not find the file build/afch.js. You probably should run \"grunt build\" (no quotes).");
	process.exit(0);
}

const port = process.env.PORT || argv.port || 4444;
console.log(`Serving AFCH at https://localhost:${port} (Ctrl+C to stop). To install: go to https://test.wikipedia.org/w/index.php?title=Special:MyPage/common.js&action=edit (logging in if you get an error) and add this on a new line if it's not there yet:

  mw.loader.load('https://localhost:${port}?ctype=text/javascript&title=afch-dev.js', 'text/javascript' );

Reminder: you MUST run "grunt build" (no quotes) after you change the code to update the script.`);

https.createServer(options, function (req, res) {
	const reqUrl = new URL(req.url, `http://${req.headers.host}`);
	if((!reqUrl.searchParams.has("ctype")) || (!reqUrl.searchParams.has("title"))) {
		res.writeHead(400);
		res.end("Parameters 'ctype' and/or 'title' not present. If you navigated to this page using your browser, the server is working correctly! Try visiting a draft page (see <a href='https://en.wikipedia.org/wiki/Wikipedia:WikiProject_Articles_for_creation/Helper_script/Contributing/Developer_setup'>the instructions</a>).");
		return;
	}
	res.writeHead(200, {
		"Content-Type": reqUrl.searchParams.get("ctype"),
		"Access-Control-Allow-Origin": "*",
	});
	var reqTitle = reqUrl.searchParams.get("title");
	var filename = null;

	// This is the reverse of what happens to filenames in scripts/upload.py
	if(reqTitle.endsWith("core.js")) {
		filename = "build/modules/core.js";
	} else if(reqTitle.endsWith("submissions.js")) {
		if(reqTitle.endsWith("tpl-submissions.js")) {
			filename = "build/templates/tpl-submissions.html";
		} else {
			filename = "build/modules/submissions.js";
		}
	} else if(reqTitle.endsWith("tpl-preferences.js")) {
		filename = "build/templates/tpl-preferences.html";
	} else if(reqTitle.endsWith(".css")) {
		filename = "build/afch.css";
	} else if(reqTitle.endsWith(".js")) {
		// Assume all other JS files are the root. This probably isn't ideal.
		filename = "build/afch.js";
	} else {
		console.error(`bad filename ${filename}`);
	}
	var content = fs.readFileSync(filename, { encoding: "utf-8" });
	content = content.replace(
		"AFCH.consts.scriptpath = mw.config.get( 'wgServer' ) + mw.config.get( 'wgScript' );",
		`AFCH.consts.scriptpath = 'https://localhost:${port}';`
	)
		.replace("AFCH beta", "AFCH DEV");
	res.end(content);
}).listen(port);
