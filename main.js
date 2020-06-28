var express = require('express'),
    app = express(),
    bodyParser = require('body-parser'),
    server = require('http').createServer(app),
    io = require('socket.io').listen(server),
    os = require("os");


const {
    uuid
} = require('./functions');
// ---------------------------- lowdb ----------------------------
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync('database/db.json');
const db = low(adapter);

// ---------------------------- lowdb ----------------------------

server.listen(8001);
console.log("listen on http://localhost:8001");


app.use(bodyParser.json());

app.get('/', function (req, res) {
    res.sendfile(__dirname + '/socket.html');
});
app.get(/(.*)\.(jpg|gif|png|ico|css|js|txt)/i, function (req, res) {
    res.sendfile(__dirname + "/" + req.params[0] + "." + req.params[1], function (err) {
        if (err) res.send(404);
    });
});



// ---------------------------- Global  ----------------------------
var onlineCount = 0;

// ---------------------------- APIs ----------------------------
app.post('/join', function (req, res) {
    var roomid = req.body.roomid;
    var stuid = req.body.studentid;
    var find = db.get('rooms').find({
        id: roomid
    }).value();

    var result = {
        success: false,
        id: '',
        creator: ''
    }

    if (find) {
        if (find.stulist.indexOf(stuid) == -1) {
            find.stulist.push(stuid);
        }

        db.get('rooms').find({
                id: roomid
            }).assign(find)
            .write();

        result.success = true;
        result.id = find.id;
        result.creator = find.creator;
    }
    res.json(result);
});

app.post('/newroom', function (req, res) {
    var creator = req.body.creator;
    var roomid = uuid().substring(0, 8).toUpperCase();

    db.get('rooms')
        .push({
            id: roomid,
            stulist: [],
            creator: creator,
            create_time: new Date()
        })
        .write();

    res.json({
        success: true,
        id: roomid,
        creator: creator
    });
});

app.get('/assigns', function (req, res) {
    var roomid = req.query.roomid;
    var studentid = req.query.studentid;

    var assigns = db.get('assigns').filter({
        roomid: roomid
    }).value();

    var submits = db.get('submits').filter({
        studentid: studentid,
        roomid: roomid
    }).value();

    // 檢查繳交
    for (var i in assigns) {
        let ass = assigns[i];
        let hadSubmit = submits.some(s => s.sequence == ass.sequence);
        ass.submited = hadSubmit || false;
    }


    res.json(assigns || []);
});

app.get('/assignBySeq', function (req, res) {
    var roomid = req.query.roomid;
    var sequence = req.query.sequence;

    var assign = db.get('assigns').find({
        sequence: parseInt(sequence),
        roomid: roomid
    }).value();


    res.json(assign || null);
});

app.get('/submitlist', function (req, res) {
    var roomid = req.query.roomid;
    var list = db.get('submits').filter({
            roomid: roomid
        }).sortBy('studentid')
        .value();

    for (var i in list) {
        list[i].answer_draw = req.protocol + '://' + req.headers.host + '/database/images/' + list[i].answer_draw;
    }

    res.json(list || null);
})

app.post('/submitanswer', function (req, res) {
    var studentid = req.body.studentid;
    var roomid = req.body.roomid;
    var sequence = req.body.sequence;
    var type = req.body.type;
    var submit_time = new Date();
    var answer_option_index = req.body.answer_option_index; // 由 0 開始算
    var answer_text = req.body.answer_text;
    var answer_draw = `${studentid}_${roomid}_${sequence}`;

    if (type == '畫圖作答') {
        var base64Data = req.body.answer_draw.replace(/^data:image\/png;base64,/, "");

        require("fs").writeFile(`database/images/${studentid}_${roomid}_${sequence}.png`, base64Data, 'base64', function (err) {
            console.log(err);
        });
    }

    var exist = db.get('submits').find({
        studentid: studentid,
        roomid: roomid,
        sequence: sequence
    }).value();


    var insert = {
        "studentid": studentid,
        "roomid": roomid,
        "sequence": sequence,
        "type": type,
        "submit_time": submit_time,
        "answer_option_index": answer_option_index,
        "answer_text": answer_text,
        "answer_draw": answer_draw,
        "get_point": null
    };


    if (exist) {
        db.get('submits').find({
                studentid: studentid,
                roomid: roomid,
                sequence: sequence
            })
            .assign(insert)
            .write();
    } else {
        db.get('submits')
            .push(insert)
            .write();
    }

    res.json({
        success: true
    });
});

io.sockets.on('connection', function (socket) {
    // 上線人數
    onlineCount++;

    // 接收來自於瀏覽器的資料
    socket.on('client_data', function (data) {
        process.stdout.write(data.letter + ' '); // 不換行

        socket.broadcast.emit('message', {
            'date': new Date(),
            'message': data.letter
        });
    });

    // 離線
    socket.on('disconnect', () => {
        // 有人離線了，扣人
        onlineCount = (onlineCount < 0) ? 0 : onlineCount -= 1;
    });
});