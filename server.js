var express = require('express'),
    app = express(),
    bodyParser = require('body-parser'),
    server = require('http').createServer(app),
    io = require('socket.io').listen(server),
    os = require("os");


const {
    uuid,
    deepCopy
} = require('./functions');
// ---------------------------- lowdb ----------------------------
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync('database/db.json');
const db = low(adapter);

// ---------------------------- lowdb ----------------------------
var port = process.env.PORT || 8001;
server.listen(port, function () {
    console.log("Listening on http://localhost:" + port);
});


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

io.sockets.on('connection', function (socket) {
    // 上線人數
    onlineCount++;


    // 接收來自於瀏覽器的資料
    socket.on('join', function (data) {
        process.stdout.write(data.studentid + '加入了房間。 '); // 不換行
        if (data.role == '學生') {
            socket.broadcast.emit('message', "學號 " + data.studentid + " 加入了房間。");
        }
    });

    socket.on('broadcast_release_server', function (data) {
        socket.broadcast.emit('broadcast_release_client', data.message);
    });

    socket.on('broadcast_revise_server', function (data) {
        socket.broadcast.emit('broadcast_revise_client', data.message);
    });

    // 離線
    socket.on('disconnect', () => {
        // 有人離線了，扣人
        onlineCount = (onlineCount < 0) ? 0 : onlineCount -= 1;
    });
});

app.post('/join', function (req, res) {
    var roomid = req.body.roomid;
    var stuid = req.body.studentid;
    var find = db.get('rooms').find({
        id: roomid
    }).value();

    var result = {
        success: false,
        id: '',
        creator: '',
        role: ''
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
        result.room_name = find.room_name;
        result.role = find.creator == stuid ? '老師' : '學生';
    }
    res.json(result);
});

app.post('/newroom', function (req, res) {
    var creator = req.body.creator;
    var room_name = req.body.room_name;
    var roomid = uuid().substring(0, 8).toUpperCase();

    db.get('rooms')
        .push({
            id: roomid,
            room_name: room_name,
            stulist: [],
            creator: creator,
            create_time: new Date()
        })
        .write();

    res.json({
        success: true,
        id: roomid,
        room_name: room_name,
        creator: creator
    });
});

app.get('/assigns_all', function (req, res) {
    var roomid = req.query.roomid;

    var assigns = db.get('assigns').filter({
        roomid: roomid
    }).value();

    res.json(assigns || []);
});

app.get('/assigns', function (req, res) {
    var roomid = req.query.roomid;
    var studentid = req.query.studentid;

    var assigns = db.get('assigns').filter({
        roomid: roomid,
        release: true
    }).value();


    if (assigns && assigns.length > 0 && studentid) {
        var submits = db.get('submits').filter({
            studentid: studentid,
            roomid: roomid
        }).value();

        assigns = deepCopy(assigns);
        submits = deepCopy(submits);
        // 檢查繳交
        for (var i in assigns) {
            let ass = assigns[i];
            let hadSubmit = submits.some(s => s.sequence == ass.sequence);
            ass.submited = hadSubmit || false;

            let find = submits.find(s => s.sequence == ass.sequence);
            ass.had_revise = find ? find.had_revise : false;
            ass.get_point = find ? find.get_point : null;
        }
    }

    res.json(assigns || []);
});

app.post('/new_assigns', function (req, res) {
    var roomid = req.body.roomid;
    var type = req.body.type;
    var point = req.body.point;
    var content = req.body.content;
    var options = req.body.options;

    var last = db.get('assigns')
    .filter({roomid:roomid})
    .last()
    .value();
    var last_sequence = last ? last.sequence : 0;

    db.get('assigns')
        .push({
            roomid: roomid,
            sequence: ++last_sequence,
            point: point,
            type: type,
            content: content,
            options: options,
            create_time: new Date(),
            release: false
        })
        .write();

    res.json({
        success: true
    });
});

app.post('/release_assigns', function (req, res) {
    var roomid = req.body.roomid;
    var sequence = req.body.sequence;
    var release = req.body.release;

    db.get('assigns').find({
            roomid: roomid,
            sequence: sequence
        }).assign({
            release: release
        })
        .write();

    res.json({
        success: true
    });
});

app.get('/assignBySeq', function (req, res) {
    var roomid = req.query.roomid;
    var sequence = req.query.sequence;
    var studentid = req.query.studentid;

    var assign = db.get('assigns').find({
        sequence: parseInt(sequence),
        roomid: roomid
    }).value();

    var submits = db.get('submits').find({
        studentid: studentid,
        sequence: parseInt(sequence),
        roomid: roomid
    }).value();

    assign = deepCopy(assign);
    if (submits) {
        assign.answer_option_index = submits.answer_option_index;
        assign.answer_text = submits.answer_text;
        assign.answer_draw = submits.answer_draw;
        assign.had_revise = submits.had_revise;
        assign.get_point = submits.get_point;
        assign.suggestion = submits.suggestion;
    }
    res.json(assign || null);
});

app.get('/submitlist', function (req, res) {
    var roomid = req.query.roomid;
    var list = db.get('submits').filter({
            roomid: roomid
        }).sortBy(['studentid', 'sequence'])
        .groupBy('studentid')
        .value();

    list = deepCopy(list);

    for (var i in list) {
        for (var j in list[i]) {
            var anss = db.get('assigns').find({
                roomid: roomid,
                sequence: list[i][j].sequence
            }).value();
            
            list[i][j].point = anss.point;
            list[i][j].content = anss.content;
            list[i][j].options = anss.options;
        }
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
    var answer_draw = '';

    if (type == '畫圖作答') {
        answer_draw = `${studentid}_${roomid}_${sequence}`;
        var base64Data = req.body.answer_draw.replace(/^data:image\/png;base64,/, "");

        require("fs").writeFile(`database/submits/${studentid}_${roomid}_${sequence}.png`, base64Data, 'base64', function (err) {
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

app.post('/revise', function (req, res) {
    var studentid = req.body.studentid;
    var roomid = req.body.roomid;
    var sequence = req.body.sequence;
    var get_point = req.body.get_point;
    var suggestion = req.body.suggestion;

    db.get('submits').find({
            studentid: studentid,
            roomid: roomid,
            sequence: sequence
        }).assign({
            had_revise: true,
            get_point: get_point,
            suggestion: suggestion
        })
        .write();

    res.json({
        success: true
    });
});

