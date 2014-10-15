var minimist = require('minimist');
var db = require('level')('/tmp/edit.db');
var fdb = require('../')(db);
var argv = minimist(process.argv.slice(2), {
    default: { hash: Math.floor(Math.pow(16,8) * Math.random()).toString(16) }
});

fdb.links(argv._[0]).on('data', console.log);
