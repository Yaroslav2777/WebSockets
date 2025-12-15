const WebSocket = require('ws');
const http = require('http');
const url = require('url');

const httpServer = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  
  if (parsedUrl.pathname === '/disconnect' && req.method === 'GET') {
    const userId = parsedUrl.query.userId;
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    
    if (!userId) {
      res.writeHead(400);
      res.end(JSON.stringify({ 
        success: false, 
        message: 'userId не вказано' 
      }));
      return;
    }
    
    let userFound = false;
    let username = '';
    
    for (let [ws, clientInfo] of clients) {
      if (clientInfo.id === userId) {
        userFound = true;
        username = clientInfo.username;
        
        const leaveMessage = JSON.stringify({
          type: 'system',
          event: 'user_left',
          userId: userId,
          username: username,
          timestamp: new Date().toISOString(),
          activeUsers: clients.size - 1
        });
        
        clients.delete(ws);
        
        broadcast(leaveMessage);
        
        ws.close(1000, 'Користувач відключився через HTTP запит');
        
        console.log(`Користувач ${username} (${userId}) відключений через HTTP запит`);
        
        break;
      }
    }
    
    if (userFound) {
      res.writeHead(200);
      res.end(JSON.stringify({ 
        success: true, 
        message: `Користувач ${username} успішно відключений`,
        username: username
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ 
        success: false, 
        message: 'Користувача не знайдено' 
      }));
    }
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ 
      success: false, 
      message: 'Маршрут не знайдено' 
    }));
  }
});

const wss = new WebSocket.Server({ server: httpServer });

const clients = new Map(); 
let userCount = 0;

const generateUserId = () => {
  return `user_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
};

wss.on('connection', (ws) => {
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

wss.on('close', () => {
  clearInterval(interval);
  console.log('Сервер зупинено');
});

httpServer.listen(3000, () => {
  console.log('Сервер чату запущено на ws://localhost:3000');
  console.log('HTTP сервер доступний на http://localhost:3000');
  console.log('Маршрут відключення: http://localhost:3000/disconnect?userId=YOUR_USER_ID');
});