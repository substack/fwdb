var db = require('level')('/tmp/edit.db');
var fdb = require('../')(db);
var minimist = require('minimist');

var argv = minimist(process.argv.slice(2));
fdb.keys(argv).on('data', console.log);
