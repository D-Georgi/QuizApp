const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (let name in interfaces) {
        for (let iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return 'localhost';
}

//const LOCAL_IP = getLocalIp();
//const PORT = 3000;

let gameState = {
    currentQuestionIndex: -1,
    students: {}, 
    answersReceived: new Set(), // Tracks which students answered the current question
    questions: fs.existsSync('questions.json') ? JSON.parse(fs.readFileSync('questions.json')) : []
};

io.on('connection', (socket) => {
    socket.on('joinGame', (name) => {
        gameState.students[socket.id] = { name: name, score: 0 };
        io.emit('updateStudentList', Object.values(gameState.students).map(s => s.name));
        io.emit('answerCountUpdate', { received: gameState.answersReceived.size, total: Object.keys(gameState.students).length });
    });

    socket.on('updateQuestions', (newQuestions) => {
        gameState.questions = newQuestions.map(({id, ...rest}) => rest);
        fs.writeFileSync('questions.json', JSON.stringify(gameState.questions));
        gameState.currentQuestionIndex = -1;
    });

    socket.on('nextQuestion', () => {
        gameState.answersReceived.clear(); // Reset progress for the new question
        gameState.currentQuestionIndex++;
        
        if (gameState.currentQuestionIndex < gameState.questions.length) {
            const q = gameState.questions[gameState.currentQuestionIndex];
            io.emit('newQuestion', { type: q.type, q: q.q, options: q.options || null });
            io.emit('answerCountUpdate', { received: 0, total: Object.keys(gameState.students).length });
        } else {
            const leaderboard = Object.values(gameState.students).sort((a, b) => b.score - a.score);
            io.emit('gameFinished', leaderboard);
        }
    });

    socket.on('submitAnswer', (answer) => {
        const student = gameState.students[socket.id];
        const currentQ = gameState.questions[gameState.currentQuestionIndex];
        if (!student || !currentQ) return;

        // Track progress
        gameState.answersReceived.add(socket.id);
        io.emit('answerCountUpdate', { 
            received: gameState.answersReceived.size, 
            total: Object.keys(gameState.students).length 
        });

        if (currentQ.type === 'MC' || currentQ.type === 'FITB') {
            const cleanAns = answer.split(',').map(s => s.trim().toLowerCase()).join(',');
            const cleanCorr = currentQ.correct.split(',').map(s => s.trim().toLowerCase()).join(',');
            if (cleanAns === cleanCorr) student.score += 1;
        } else if (currentQ.type === 'FR') {
            const log = `[${new Date().toLocaleTimeString()}] ${student.name}: ${answer}\n`;
            fs.appendFileSync('free_responses.log', log);
        }
    });
});

app.get('/get-logs', (req, res) => {
    const logs = fs.existsSync('free_responses.log') ? fs.readFileSync('free_responses.log', 'utf8') : "No logs yet.";
    res.send(logs);
});

const PORT = process.env.PORT || 3000; // Use the Cloud's port or 3000 as fallback

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});