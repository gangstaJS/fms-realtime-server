const express = require('express');
const serveStatic = require('serve-static');
const colors = require('colors');
const WebSocketServer = require('websocket').server;
const _ = require('underscore');
const cookie = require('cookie');
const url = require('url');
const LOCAL = !(process.env.NODE_ENV === 'STAGE');


console.log('LOCAL', LOCAL, process.env.NODE_ENV);

var apiURL = 'http://fms.ingram.pilgrimconsulting.com';

if(LOCAL) {
	apiURL = 'http://0.0.0.0:8080';
}

var staticDir = '.',
	app = express(),
	port = 8090,
	users = {},
	log = [],
	pullConnects = [],
	apiPATH = '/api/v1/';

app
.use(serveStatic(staticDir))

// enable CORS
.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', apiURL);
	res.setHeader('Access-Control-Allow-Credentials', true);
	next();
})

.get(`${apiPATH}j_create`, function(req, res, next) {
		var query = req.query;
		var c = req.headers.cookie || '';
		var param = cookie.parse(c);
		var login = query.login || '';

		login = login.trim();
		if(login.length) {
			var user = getUser(login);

			if(user) {
				res.end('{"stat": 0, "err": "login is already in use"}');
				return;
			}

			if(getUserBySid(param.sid)) {
				res.end('{"stat": 0, "err": "pls logout before login"}');
				return;
			}

			var sid = generateGuid();
			users[sid] = {login: login, date: (new Date()).getTime()}
			res.setHeader("Set-Cookie", ['sid='+sid+';path=/;']);

			res.end('{"stat": 1, "sid": "'+ sid +'"}');
		} else {
			res.end('{"stat": 0, "err": "empty login param"}');
		}
	
})

.use(function(req, res, next) {

	var c = req.headers.cookie || '';
	var param = cookie.parse(c);

	if(param.sid && issetSid(param.sid)) {
		next();
	} else {
		res.end('{"stat": 0}');
	}
})

.use(`${apiPATH}fleet/:fleetId`, function(req,res) {
	var fleetId = req.params.fleetId || '';
	var allowFleets = ['f1', 'f2', 'f3', 'f4'];

	if(_.contains(allowFleets, fleetId)) {
		res.end(JSON.stringify({stat: 1, fleet: require(`./data/${req.params.fleetId}`)}));
	} else {
		res.end(JSON.stringify({stat: 0, err: 'fleet not found'}));
	}
	
})

.use(`${apiPATH}j_stat`, function(req,res) {
	var c = req.headers.cookie || '';
	var param = cookie.parse(c);

	var usr = {
		stat: 1,
		login: getUserBySid(param.sid).login,
		token: param.sid,
	}

	res.end(JSON.stringify(usr));
})

.use(`${apiPATH}j_signout`, function(req,res) {
	res.setHeader("Set-Cookie", ['sid="";path=/;']);
	res.end(JSON.stringify({stat: 1}));

	dsconnUser(param.sid);
})

.use(`${apiPATH}j_get_fleets`, function(req,res) {
	res.end(JSON.stringify({L01: require('./data/f1'), R01: require('./data/f2')}));
});

// I am so sorry for this func
process.on('uncaughtException', function(err) {
  console.log(err);
  process.exit(0);
});

var server = app.listen(port);

server.on('error', function() {
  console.log("Error connection".red.bold);
});

wsServer = new WebSocketServer({
    httpServer: server,
    autoAcceptConnections: false
});

wsServer.on('request', function(request) {
	// console.log(request);

	try {

		var sid = '';

		_.each(request.cookies, function(c,n) {
			if(c.name == 'sid') sid = c.value;
		});

		var user = getUserBySid(sid);

		if(user) {
			console.log('request.origin', request.origin);
			var connection = request.accept('fms', request.origin);
			var guid = generateGuid();
			connection.guid = guid;
			pullConnects.push({user: user.login, conn: connection, guid: guid });

			console.log('Add connect', pullConnects.length);
			console.log('Conected: ' +  guid);
		} else {
			console.log('Can not get user'.red.bold);
			return;
		}


	} catch(e) {
		console.log(e.message.red.bold);
		return;
	}

	console.log(request.host + ' Connection accepted'.bgGreen.white.bold);

	connection.on('message', function(message) {
		if (message.type === 'utf8') {
			var user = users[sid];

			if(user) {
				var login = user.login;
				var data = {};

				try {
					data = JSON.parse(message.utf8Data);
				} catch(e) {
					console.log(e.message);
				};


				console.log(data);

				if(data) {
					// чистим лог чата;
					// if(log.length > 100) log = [];
					//
					// log.push({login: login, time: (new Date()).getTime(), msg: data.msg});

					// var pack = JSON.stringify({msg: data.msg, login: login}, onlineUpdate: false});

					var pack = JSON.stringify(data);

					console.log('has', this.guid);

          broadcast(pack, this.guid);
				}

			} else {
				console.log('wrong sid');
				// this.sendUTF('Error. Wromg sid');
				// wsServer.close(this);

			}


        }
	});

	connection.on('error', function(err) {
		console.log('Errorr'.red.bold, err);
	});

	connection.on('close', function(reasonCode, description) {
        console.log((new Date()).getTime() + ' Peer ' + this.guid + ' disconnected.', description);
        dsconnUser(this.guid);
    });
});

function broadcast(msg, self) {
	_.each(pullConnects, function(user, n) {
		// себе не шлем;
		if(user.guid != self) user.conn.sendUTF(msg);
	});
}

function dsconnUser(guid) {
	_.each(pullConnects, function(user, n) {
		try {
			if(user.conn.guid == guid) {
			 pullConnects.splice(n,1);

			console.log('Remove connect', pullConnects.length);
			return false;
			}
		} catch(e) {
			console.log(e.message);
		}
	});
}

function issetSid(sid) {
	return !!users[sid];
}

function getUser(login) {
	var u = false;
	_.each(users, function(user, n) {
		if(user.login == login) {
			u = user;
			return false;
		}
	});

	return u;
}

function getUserBySid(sid) {
	return users[sid] || '';
}

function generateGuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r, v;
      r = Math.random() * 16 | 0;
      v = c === 'x' ? r : r & 0x3 | 0x8;
      return v.toString(16);
    });
}

console.log(("Server is listening at port: "+port).bgGreen.white.bold);
