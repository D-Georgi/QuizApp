const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let gameState = {
    currentQuestionIndex: -1,
    students: {}, 
    answersReceived: new Set(),
    correctTracker: {}, // Stores { questionIndex: [StudentNames] }
    questions: fs.existsSync('questions.json') ? JSON.parse(fs.readFileSync('questions.json')) : []
};

io.on('connection', (socket) => {
    // Join logic
    socket.on('joinGame', (name) => {
        gameState.students[socket.id] = { name: name, score: 0 };
        io.emit('updateStudentList', Object.values(gameState.students).map(s => s.name));
        io.emit('answerCountUpdate', { received: gameState.answersReceived.size, total: Object.keys(gameState.students).length });
    });

    // Editor update logic
    socket.on('updateQuestions', (newQuestions) => {
        gameState.questions = newQuestions.map(({id, ...rest}) => rest);
        fs.writeFileSync('questions.json', JSON.stringify(gameState.questions));
        gameState.currentQuestionIndex = -1;
    });

    // Moderation (Kick) logic
    socket.on('kickStudent', (studentName) => {
        const socketIdToKick = Object.keys(gameState.students).find(
            id => gameState.students[id].name === studentName
        );
        if (socketIdToKick) {
            const kickedSocket = io.sockets.sockets.get(socketIdToKick);
            if (kickedSocket) {
                kickedSocket.disconnect();
                delete gameState.students[socketIdToKick];
                io.emit('updateStudentList', Object.values(gameState.students).map(s => s.name));
                io.emit('answerCountUpdate', { received: gameState.answersReceived.size, total: Object.keys(gameState.students).length });
            }
        }
    });

    // Game loop logic
    socket.on('nextQuestion', () => {
        gameState.answersReceived.clear();
        gameState.currentQuestionIndex++;
        
        if (gameState.currentQuestionIndex < gameState.questions.length) {
            const q = gameState.questions[gameState.currentQuestionIndex];
            io.emit('newQuestion', { 
                type: q.type, 
                q: q.q, 
                options: q.options || null,
                correct: q.correct // Sent only to teacher view logic
            });
            io.emit('answerCountUpdate', { received: 0, total: Object.keys(gameState.students).length });
        } else {
            const leaderboard = Object.values(gameState.students).sort((a, b) => b.score - a.score);
            io.emit('gameFinished', { 
                leaderboard: leaderboard, 
                reviewData: gameState.correctTracker,
                questions: gameState.questions 
            });
        }
    });

    // Answer validation
    socket.on('submitAnswer', (answer) => {
        const student = gameState.students[socket.id];
        const qIndex = gameState.currentQuestionIndex;
        const currentQ = gameState.questions[qIndex];
        if (!student || !currentQ) return;

        gameState.answersReceived.add(socket.id);
        io.emit('answerCountUpdate', { received: gameState.answersReceived.size, total: Object.keys(gameState.students).length });

        if (currentQ.type === 'MC' || currentQ.type === 'FITB') {
            const cleanAns = answer.split(',').map(s => s.trim().toLowerCase()).join(',');
            const cleanCorr = currentQ.correct.split(',').map(s => s.trim().toLowerCase()).join(',');
            
            if (cleanAns === cleanCorr) {
                student.score += 1;
                if (!gameState.correctTracker[qIndex]) gameState.correctTracker[qIndex] = [];
                gameState.correctTracker[qIndex].push(student.name);
            }
        } else if (currentQ.type === 'FR') {
            const log = `[${new Date().toLocaleTimeString()}] ${student.name}: ${answer}\n`;
            fs.appendFileSync('free_responses.log', log);
        }
    });
});

app.get('/get-logs', (req, res) => {
    const logs = fs.existsSync('free_responses.log') ? fs.readFileSync('free_responses.log', 'utf8') : "No responses logged yet.";
    res.send(logs);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});