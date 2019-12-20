const fs = require('fs')
var express = require('express');
var path = require('path');
//var sslredirect = require('./node-heroku-ssl-redirect');
var app = express();
var cors = require('cors');
var http = require('http').Server(app);
var io = require('socket.io')(http, { origins: '*:*'});
var moment = require('moment');
var mongodb = require('mongodb');
var expressLayouts = require('express-ejs-layouts')
var bodyParser = require('body-parser')
var onlinewhen = moment().utc().subtract(10, 'minutes')
var gamesort = {date:-1}
var onlineplayers = []
var movecompensation = 2
var allowedOrigins = [
  'http://localhost:4000',
  'https://localhost:8080',
  'https://ajedrezenvivo.net',
  'https://ajedrezenvivo.herokuapp.com'
]

const mongo_url = process.env.MONGO_URL;

app.use(cors({
  origin: function(origin, callback){
    if(!origin) return callback(null, true)
    if(allowedOrigins.indexOf(origin) === -1){
      var msg = 'The CORS policy for this site does not ' +
                'allow access from the specified Origin.'
      return callback(new Error(msg), false)
    }
    return callback(null, true)
  }
}))

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*"); // update to match the domain you will make the request from
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json({ type: 'application/json' }))
app.set('views', path.join(__dirname, 'static'))
app.use(express.static(path.join(__dirname, 'static')))
app.set('view engine', 'ejs')
app.use(expressLayouts)

mongodb.MongoClient.connect(mongo_url, {useNewUrlParser: true }, function(err, database) {
  if(err) throw err

  const db = database.db(mongo_url.split('/').reverse()[0])

  app.get('/', function (req, res) {
    res.render('index')
  });

  app.post('/create', function (req, res) { 

    const doc = {      
      white: req.body.white,
      black: req.body.black,
      minutes: req.body.minutes,
      date:moment().utc().format('YYYY.MM.DD'),
      event: 'Juego online',
      views: 1
    }

    db.collection('games').insertOne(doc,function (err, response) {
      if(err){ 
        console.log(err)
        return res.json({ status : 'error', message : 'Could not create game'})
      } else {
        return res.json({ status : 'success', id: response.ops[0]._id})
      }
    })
  })

  app.post('/game', function (req, res) { 
    var ObjectId = require('mongodb').ObjectId
    db.collection('games').find({
      '_id': new ObjectId(req.body.id)
    }).toArray(function(err,docs){
      var game = {}
      if(docs[0]){
        game = docs[0]
      }
      return res.json(game)
    })   
  })

  app.post('/playlist', function (req, res) { 
    var $or = []
    , limit = 5
    , offset = 0

    for(var i in req.body){
      $or.push({'black': {'$regex' : req.body.black, '$options' : 'i'}})  
      $or.push({'white': {'$regex' : req.body.white, '$options' : 'i'}})  
      $or.push({'black': {'$regex' : req.body.white, '$options' : 'i'}})  
      $or.push({'white': {'$regex' : req.body.black, '$options' : 'i'}})  
    }

    db.collection('games').find({"$or": $or})
    .sort(gamesort)
    .limit(limit)
    .skip(offset)
    .toArray(function(err,docs){
      return res.json(docs)
    })   
  })

  app.post('/online', function (req, res) { 
    db.collection('games').find({
      broadcast : true,
      updatedAt: { $gte: onlinewhen.format() },
      result: { $nin : ["0-1", "1-0", "1/2-1/2"] }
    }).toArray(function(err,docs){
      return res.json(docs)
    })   
  })

  app.post('/gamecount', function (req, res) { 
    db.collection('games').find(req.body).toArray(function(err,docs){
      return res.json(docs.length)
    })
  })

  app.post('/search', function (req, res) { 
    if(!req.body.query) return res.json({'error':'not_enough_params'})
    var $or = []
    , limit = parseInt(req.body.limit)||25
    , offset = parseInt(req.body.offset)||0
    , query = unescape(req.body.query)

    query.split(' ').forEach((word) => {
      $or.push({"white": {'$regex' : word, '$options' : 'i'}})
      $or.push({"black": {'$regex' : word, '$options' : 'i'}})
      $or.push({"event": {'$regex' : word, '$options' : 'i'}})
      $or.push({"site": {'$regex' : word, '$options' : 'i'}})
      $or.push({"date": {'$regex' : word, '$options' : 'i'}})
      $or.push({"pgn": {'$regex' : word, '$options' : 'i'}})
    })

    db.collection('games').countDocuments({"$or": $or}, function(error, numOfDocs){
      db.collection('games').find({"$or": $or})
        .sort(gamesort)
        .limit(limit)
        .skip(offset)
        .toArray(function(err,docs){
          return res.json({games:docs,count:numOfDocs})
        })   
    })
  })

  io.on('connection', function(socket){ //join room on connect

    socket.on('join', function(id) {
      socket.join(id)
    })

    socket.on('leave', function(id) {
      socket.leave(id)
    })

    socket.on('reject', function(data) {
      io.emit('reject', data)
    })

    socket.on('resume', function(data) {
      io.emit('resume', data)
    })

    socket.on('play', function(data) {
      io.emit('play', data)
    })

    socket.on('invite', function(data) {
      io.emit('invite', data)
    })

    socket.on('preferences', function(data) {
      var exists = false
      for(var i = 0; i < onlineplayers.length; i++ ){
        if(onlineplayers[i] === data.nick){
          exists = true
        }
      }
      var data = {
        exists: exists,
        nick: data.nick,
        oldnick: data.oldnick
      }
      io.emit('nick', data)
    })

    socket.on('lobby_join', function(player) {
      if(player.available === false) return
      var exists = false
      for(var i = 0; i < onlineplayers.length; i++ ){
        if(onlineplayers[i] === player.code){
          exists = true
        }
      }
      if(exists === false){
        onlineplayers.push(player.code)
      }
      io.emit('players', onlineplayers)
    })

    socket.on('lobby_leave', function(player) {
      var exists = false
      for(var i = 0; i < onlineplayers.length; i++ ){
        if(onlineplayers[i] === player.code){
          onlineplayers.splice(i, 1)
        }
      }
      io.emit('players', onlineplayers)
    })

    socket.on('start', function(data) {
      io.to(data.id).emit('start', data)
    })

    socket.on('capitulate', function(data) {
      io.to(data.id).emit('capitulate', data)
    })

    socket.on('askfordraw', function(data) {
      io.to(data.id).emit('askfordraw', data)
    })

    socket.on('gone', function(data) {
      io.to(data.id).emit('gone', data)
    })
    
    socket.on('undo', function(data) { //undo emitter
      io.to(data.id).emit('undo', data)
    })

    socket.on('chat', function(data) { //move object emitter
      io.to(data.id).emit('chat', data)
    })

    socket.on('move', function(move) { //move object emitter
      var item = move
      var id = move.id
      var t = move.turn === 'w' ? 'b' : 'w'
      move[t + 'time'] += movecompensation
      item.updatedAt = moment().utc().format()
      delete item.id 
      var ObjectId = require('mongodb').ObjectId
      return db.collection('games').findOneAndUpdate(
      {
        '_id': new ObjectId(id)
      },
      {
        "$set": item
      },{ new: true }).then(function(doc){
        io.to(id).emit('move', move)
      })
    })

    socket.on('data', function(data) { //data object emitter
      var item = data
      var id = data.id

      item.updatedAt = moment().utc().format()      
      delete item.id 

      var ObjectId = require('mongodb').ObjectId
      return db.collection('games').findOneAndUpdate(
      {
        '_id': new ObjectId(id)
      },
      {
        "$set": item
      },{ new: true }).then(function(doc){
        io.to(id).emit('data', data)
      })
    })
  })

  var server = http.listen(process.env.PORT, function () { //run http and web socket server
    var host = server.address().address
    var port = server.address().port
  })
})