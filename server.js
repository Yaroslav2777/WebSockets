const WebSocket = require('ws');

const server = new WebSocket.Server({ port: 3000 });
const clients = new Map(); 
let userCount = 0;

const generateUserId = () => {
  return `user_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
};

server.on('connection', (ws) => {
  const userId = generateUserId();
  userCount++;
    clients.set(ws, {
    id: userId,
    username: `Користувач ${userCount}`,
    lastActive: Date.now(),
    isActive: true
  });
  
  console.log(`Користувач ${userId} приєднався. Активних користувачів: ${clients.size}`);
  
  const joinMessage = JSON.stringify({
    type: 'system',
    event: 'user_joined',
    userId: userId,
    username: `Користувач ${userCount}`,
    timestamp: new Date().toISOString(),
    activeUsers: clients.size
  });
  
  broadcast(joinMessage, ws); 
  
  ws.send(JSON.stringify({
    type: 'system',
    event: 'welcome',
    message: `Вітаємо в чаті! Ваш ID: ${userId}`,
    userId: userId,
    timestamp: new Date().toISOString()
  }));
  
  ws.on('message', (data) => {
    try {
      const message = data.toString();
      console.log(`Отримане повідомлення від ${userId}:`, message);
      
      const clientInfo = clients.get(ws);
      if (clientInfo) {
        clientInfo.lastActive = Date.now();
        clientInfo.isActive = true;
      }
      
      let parsedMessage;
      try {
        parsedMessage = JSON.parse(message);
      } catch (e) {
        parsedMessage = {
          type: 'message',
          content: message,
          userId: userId,
          username: clientInfo ? clientInfo.username : `Користувач ${userCount}`,
          timestamp: new Date().toISOString()
        };
      }
      
      if (!parsedMessage.userId) {
        parsedMessage.userId = userId;
        parsedMessage.username = clientInfo ? clientInfo.username : `Користувач ${userCount}`;
        parsedMessage.timestamp = new Date().toISOString();
      }
      
      broadcast(JSON.stringify(parsedMessage), ws);
      
    } catch (error) {
      console.error('Помилка обробки повідомлення:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Помилка обробки повідомлення'
      }));
    }
  });
  
  ws.on('close', (code, reason) => {
    const clientInfo = clients.get(ws);
    if (clientInfo) {
      console.log(`Користувач ${clientInfo.username} (${userId}) від'єднався. Код: ${code}, Причина: ${reason || 'Невідомо'}`);
      
      const leaveMessage = JSON.stringify({
        type: 'system',
        event: 'user_left',
        userId: userId,
        username: clientInfo.username,
        timestamp: new Date().toISOString(),
        activeUsers: clients.size - 1
      });
      
      clients.delete(ws);
      broadcast(leaveMessage);
    }
  });
  
  ws.on('error', (error) => {
    console.error(`Помилка WebSocket для користувача ${userId}:`, error);
    
    setTimeout(() => {
      if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        console.log(`Спроба перепідключення для ${userId}...`);
      }
    }, 5000);
  });
  
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

function broadcast(message, excludeWs = null) {
  for (let [client, clientInfo] of clients) {
    if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
      try {
        client.send(message);
      } catch (error) {
        console.error('Помилка відправки повідомлення:', error);
      }
    }
  }
}

const interval = setInterval(() => {
  for (let [ws, clientInfo] of clients) {
    if (ws.isAlive === false) {
      console.log(`З'єднання з користувачем ${clientInfo.username} втрачено`);
      
      const timeoutMessage = JSON.stringify({
        type: 'system',
        event: 'user_timeout',
        userId: clientInfo.id,
        username: clientInfo.username,
        timestamp: new Date().toISOString(),
        message: 'Користувач відключився через неактивність'
      });
      
      ws.terminate();
      clients.delete(ws);
      broadcast(timeoutMessage);
      continue;
    }
    
    ws.isAlive = false;
    ws.ping();
    
    if (clientInfo && Date.now() - clientInfo.lastActive > 30000) { 
      clientInfo.isActive = false;
    }
  }
}, 30000);

server.on('close', () => {
  clearInterval(interval);
  console.log('Сервер зупинено');
});

console.log('Сервер чату запущено на ws://localhost:3000');