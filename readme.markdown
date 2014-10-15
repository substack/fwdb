# fwdb

forking historical link database on top of leveldb

Use this package as a low-level link juggler for something like a
[content-addressed append-only key/value blob store](https://npmjs.org/package/forkdb).

The semantic model of this module is best described in the forkdb readme, but
the gist is that you insert documents by the hash of their content (which is not
handled by this module itself) and then you link to previous documents by their
hash in the contents of the new document itself.

Just offer @dominictarr your couch and wifi password for a few weeks and
everything will start to make sense.

[![build status](https://secure.travis-ci.org/substack/fwdb.png)](http://travis-ci.org/substack/fwdb)

# example

Using `fdb.create()` we can create some documents:

``` js
var db = require('level')('/tmp/edit.db');
var fdb = require('fwdb')(db);
var minimist = require('minimist');

var argv = minimist(process.argv.slice(2));
if (argv.debug) fdb.on('batch', console.log);

fdb.create(argv, function (err) {
    if (err) throw err;
});
```

Now let's create a document under the key `robots` with the hash `aaa`:

```
$ node create.js --key=robots --hash=aaa
```

Note that `aaa` is not a very good hash but it's not the job of this module to
generate hashes.

Now with `fdb.heads()` we can query the internal database for a list of heads:

``` js
var db = require('level')('/tmp/edit.db');
var fdb = require('fwdb')(db);
var minimist = require('minimist');

var argv = minimist(process.argv.slice(2));
fdb.heads(argv._[0]).on('data', console.log);
```

``` 
$ node heads.js robots
{ hash: 'aaa' }
```

We can add a new document that points back at the previous document. This makes
our new document `bbb` the new head for the `robots` key:

```
$ node create.js --key=robots --hash=bbb --prev=aaa
$ node heads.js robots
{ hash: 'bbb' }
```

Each key can have many heads. If we point back at `aaa` in a new document (or
any other document in the history) the `robots` key will have two heads:

```
$ node heads.js robots
{ hash: 'bbb' }
{ hash: 'ccc' }
```

We can also link back to multiple documents in the past, which merges the
previous heads back into a single head:

```
$ node create.js --key=robots --hash=ddd --prev=bbb --prev=ccc
$ node heads.js robots
{ hash: 'ddd' }
```

New documents can appear in any order. So if we get a new document `ggg` that
points at a document `fff` that we haven't seen before, this is fine: we just
get a new head until the links can be resolved later:

```
$ node create.js --key=robots --hash=ggg --prev=fff
$ node heads.js robots
{ hash: 'ddd' }
{ hash: 'ggg' }
$ node create.js --key=robots --hash=fff --prev=eee
$ node heads.js robots
{ hash: 'ddd' }
{ hash: 'ggg' }
$ node create.js --key=robots --hash=eee --prev=ddd
$ node heads.js robots
{ hash: 'ggg' }
```

We can see what documents link back to a document after that document was
created using `fdb.links()`:

``` js
var db = require('level')('/tmp/edit.db');
var fdb = require('fwdb')(db);
var minimist = require('minimist');

var argv = minimist(process.argv.slice(2));

fdb.links(argv._[0]).on('data', console.log);
```

Now we can print out the forward links:

```
$ node links.js aaa
{ key: 'robots', hash: 'bbb' }
{ key: 'robots', hash: 'ccc' }
$ node links.js fff
{ key: 'robots', hash: 'ggg' }
```

For links that point backward in time, you should include the hash content
itself in the document body because those documents already exist.

It's also possible to query all the keys present in the local database:

``` js
var db = require('level')('/tmp/edit.db');
var fdb = require('fwdb')(db);
var minimist = require('minimist');

var argv = minimist(process.argv.slice(2));
fdb.keys(argv).on('data', console.log);
```

```
$ node keys.js 
{ key: 'robots' }
$ node create.js --key=yay --hash=beepboop
$ node keys.js
{ key: 'robots' }
{ key: 'yay' }
```

# methods

``` js
var fwdb = require('fwdb')
```

## var fw = fwdb(db)

Create a fwdb instance `fw` from a leveldb handle `db`.

## fw.create(opts, cb)

Store a document given: 

* `opts.key` - keyspace as a string
* `opts.hash` - hash of the document as a string
* `opts.prev` - array of string hashes of any previous documents to link back to
* `opts.prebatch(rows, cb)` - function that gets called before `db.batch()`
where you can add extra rows to the batch; keys are bytewise encoded

`cb(err)` fires at the end of the operation with any errors.

## var r = fw.heads(key, cb)

Return an object stream of all the heads present for the given `key`.

Objects in the output stream are of the form:

```
{ hash: '...' }
```

If provided, `cb(err, heads)` fires with the buffered array of output objects.

## var r = fw.links(key, cb)

Return an object stream of all the links present for the given `key`.

Objects in the output stream are of the form:

```
{ hash: '...', key: '...' }
```

If provided, `cb(err, links)` fires with the buffered array of output objects.

## var r = fw.keys(opts={}, cb)

Return an object stream of all the keys present in the database.

Optionally bound the query with `opts.gt` and `opts.lt`.

Objects in the output stream are of the form:

```
{ key: '...' }
```

If provided, `cb(err, keys)` fires with the buffered array of output objects.

# install

With [npm](https://npmjs.org) do:

```
npm install fwdb
```

# license

MIT
