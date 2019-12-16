if (process.argv.length < 3) {
  console.log('Usage: node ' + process.argv[1] + ' FILENAME');
  process.exit(1);
}

const fs = require('fs')
var path = require('path');
var moment = require('moment');
var mongodb = require('mongodb');
var filename = process.argv[2];
var games = {}
var index = 0

var gen_room = function (factor){ 
  return Math.random().toString(36).substring(2, factor) + Math.random().toString(36).substring(2, factor)
}

mongodb.MongoClient.connect(process.env.MONGO_URL, {useNewUrlParser: true }, function(err, database) {
  if(err) throw err

  const db = database.db(process.env.MONGO_URL.split('/').reverse()[0])

  fs.readFile(filename, 'utf8', function(err, data) {
    if (err) throw err;
    console.log('OK: ' + filename);

    var parts = data.split(/\s\r\n\r\n/).reverse()
    parts.forEach((part,index) => {
      if(index%2===0){

        const re = /\[(.*?)\]/g;
        let current;
        var game = {}

        while (current = re.exec(part)) {
          var m = current.pop()
          var parts2 = m.split(' ')
          var k = parts2[0].toLowerCase()
          delete parts2[0]
          var v = parts2.join(' ').split('"').join('').trim()
          game[k] = v;
        }

        var parts3 = part.split(/\r\n\r\n/)
        game.pgn = parts3[parts3.length-1]
        game.room = gen_room(8)

        games[Object.keys(games).length] = game
      }
    })

    setInterval(() => {

      if(index <= Object.keys(games).length){
        var game = games[index]
        index++
        if(game){
          db.collection('games').findOneAndUpdate(
          {
            event:game.event,
            white:game.white,
            site:game.site,
            black:game.black,
            result:game.result
          },
          {
            "$set": game
          },{ 
            upsert: true, 
            'new': true, 
            returnOriginal:true
          }).then(function(doc){
            console.log('OK game loaded ' + index)
            if(doc && doc.value){
              console.log(doc.value.white+' vs '+doc.value.black + ' (' + doc.value.date + ')');
            }
          })
        } else {
          console.log("ERR game load fail " + index)
        }
      }
    },5000)
  });
});