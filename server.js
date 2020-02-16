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
var playersIdle = []
var matchesLive = []
var movecompensation = 2
var allowedOrigins = [
  'http://0.0.0.0:8000',
  'http://192.168.2.13:8000',
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
      compensation: req.body.compensation,
      date:moment().utc().format('YYYY.MM.DD'),
      event: 'Juego online',
      broadcast: true,
      views: 0
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

  app.post('/eco/pgn', function (req, res) { 
    db.collection('eco_es').find({
      pgn: new RegExp(req.body.pgn, 'i')
    }).toArray(function(err,docs){
      return res.json(docs[0])
    })
  })

  app.post('/eco/name', function (req, res) { 
    db.collection('eco_es').find({
      name: new RegExp(req.body.pgn, 'i')
    }).toArray(function(err,docs){
      return res.json(docs[0])
    })
  })

  app.post('/eco', function (req, res) { 
    db.collection('eco_es').find({}).toArray(function(err,docs){
      return res.json(docs)
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

    db.collection('games').countDocuments({"pgn" : { $exists: true, $ne: null }, "$or": $or}, function(error, numOfDocs){
      db.collection('games').find({"pgn" : { $exists: true, $ne: null }, "$or": $or})
        .sort(gamesort)
        .limit(limit)
        .skip(offset)
        .toArray(function(err,docs){
          return res.json({games:docs,count:numOfDocs})
        })   
    })
  })

  io.on('connection', function(socket){ //join room on connect

    socket.on('disconnect', function() {
      console.log("disconnect")
      for(var i = 0; i < playersIdle.length; i++ ){
        if(playersIdle[i].socket === socket.id){
          console.log(playersIdle[i].code + " just disconnected")
          playersIdle.splice(i, 1)
        }
      }
      io.emit('players', playersIdle)
    })

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

    socket.on('invite_rematch', function(data) {
      io.emit('invite_rematch', data)
    })

    socket.on('reject_rematch', function(data) {
      io.emit('reject_rematch', data)
    })

    socket.on('lobby_chat', function(data) { //move object emitter
      io.emit('lobby_chat', data)
    })

    socket.on('preferences', function(data) {
      var exists = false
      for(var i = 0; i < playersIdle.length; i++ ){
        if(playersIdle[i].code === data.nick && playersIdle[i].socket != socket.id){
          exists = true
        }
      }
      data.exists = exists
      io.emit('player', data)
    })

    socket.on('match_start', function(data) {
      var exists = false
      for(var i = 0; i < matchesLive.length; i++ ){
        if(matchesLive[i].id === data.id || matchesLive[i].white === data.white && matchesLive[i].black === data.black){
          exists = true
        }
      }
      if(exists === false){
        console.log(data.id + " match started")
        matchesLive.push(data)
      }
      io.emit('matches_live', matchesLive)
    })

    socket.on('match_end', function(data) {
      for(var i = 0; i < matchesLive.length; i++ ){
        if(matchesLive[i].id === data.id){
          console.log(data.id + " match ends")
          matchesLive.splice(i, 1)
        }
      }
      io.emit('matches_live', matchesLive)
    })

    socket.on('lobby_join', function(data) {
      var exists = false
      for(var i = 0; i < playersIdle.length; i++ ){
        if(playersIdle[i].code === data.code){
          exists = true
        }
      }
      if(exists === false){
        console.log(data.code + " joins. mode: " + (data.observe ? '👁️' : '👤'))
        playersIdle.push({
          code: data.code,
          socket:socket.id,
          observe: data.observe
        })
      }
      io.emit('players', playersIdle)
    })

    socket.on('lobby_leave', function(data) {
      for(var i = 0; i < playersIdle.length; i++ ){
        if(playersIdle[i].code === data.code){
          console.log(data.code + " leaves")
          playersIdle.splice(i, 1)
        }
      }
      io.emit('players', playersIdle)
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

    socket.on('acceptdraw', function(data) {
      io.to(data.id).emit('acceptdraw', data)
    })

    socket.on('rejectdraw', function(data) {
      io.to(data.id).emit('rejectdraw', data)
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

    socket.on('move', function(data) { //move object emitter
      var id = data.id
      var item = {}
      var compensation = data.compensation||0
      for(var i in data){
        item[i] = data[i]
      }
      var t = data.turn === 'w' ? 'b' : 'w'
      data[t + 'time'] += compensation
      item[t + 'time'] = data[t + 'time']
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
        io.to(id).emit('move', data)

        const match = {}
        for(var i in data){
          match[i] = data[i]
        }
        match.white = doc.value.white
        match.black = doc.value.black
        io.emit('match_live', match)
      })
    })

    socket.on('data', function(data) { //data object emitter
      var item = {}
      for(var i in data){
        item[i] = data[i]
      }

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

        if(data.result){
          for(var i = 0; i < matchesLive.length; i++ ){
            if(matchesLive[i].id === data.id){
              console.log(data.id + " match ends")
              matchesLive.splice(i, 1)
            }
          }

          setTimeout(() => {
            io.emit('matches_live', matchesLive)
          },10000)
        }
      })
    })
  })

  var server = http.listen(process.env.PORT, function () { //run http and web socket server
    var host = server.address().address
    var port = server.address().port
  })
})