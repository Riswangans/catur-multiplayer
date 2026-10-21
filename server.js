'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { Chess } = require('chess.js');
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const PORT = process.env.PORT || 10000;
const GAME_API_KEY = process.env.GAME_API_KEY || '';
const rooms = new Map();
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req,res)=>res.json({ok:true,service:'game-botwhatsapp',rooms:rooms.size}));
app.get('/', (_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/catur', (_req,res)=>res.redirect('/catur.html'));
app.get('/ludo', (_req,res)=>res.redirect('/ludo.html'));
function apiAuth(req,res,next){
  if (!GAME_API_KEY || req.get('x-game-api-key') !== GAME_API_KEY) return res.status(401).json({ok:false,error:'API key tidak valid. Atur GAME_API_KEY di server dan Secret Wibusoft.'});
  next();
}
function cleanName(v){return String(v||'Pemain').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,18)||'Pemain';}
function code(){let c;do{c=crypto.randomBytes(4).toString('hex').slice(0,5).toUpperCase();}while(rooms.has(c)||/^\d+$/.test(c));return c;}
function token(){return crypto.randomBytes(24).toString('hex');}
function safeJid(j){return typeof j==='string' && /^[0-9]+@(s\.whatsapp\.net|lid)$/.test(j);}
function send(ws,o){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(o));}
function broadcast(r,o){for(const p of r.players)send(p.ws,o);}
function playerForToken(r,t){return r.players.find(p=>p.token===t);}
function createRoom(game,stake=0,creatorJid=null){const r={code:code(),game,stake,players:[],createdAt:Date.now(),lastActivity:Date.now(),finished:false,winnerJid:null,claimed:false,refunded:new Set(),chess:game==='chess'?new Chess():null,ludo:game==='ludo'?{turn:0,dice:null,players:[],winner:null}:null};rooms.set(r.code,r);if(creatorJid){const p={jid:creatorJid,token:token(),name:'Pemain',seat:0,ws:null};r.players.push(p);if(game==='ludo')r.ludo.players.push({seat:0,tokens:[-1,-1,-1,-1],finished:0});}return r;}
function playerPublic(p){return p?{name:p.name,seat:p.seat}:null;}
function chessState(r){const c=r.chess;return {type:'state',game:'chess',roomCode:r.code,players:{white:r.players[0]?.name||null,black:r.players[1]?.name||null},fen:c.fen(),turn:c.turn(),pgn:c.pgn(),history:c.history(),gameOver:c.isGameOver()||r.finished,check:c.isCheck(),checkmate:c.isCheckmate(),draw:c.isDraw(),stalemate:c.isStalemate(),insufficientMaterial:c.isInsufficientMaterial(),winner:r.winnerJid? (r.players.find(p=>p.jid===r.winnerJid)?.seat===0?'white':'black'):(c.isCheckmate()?(c.turn()==='w'?'black':'white'):null),stake:r.stake,gameResult:r.finished?(r.winnerJid?'finished':'void'):'playing'};}
function ludoState(r){return {type:'state',game:'ludo',roomCode:r.code,stake:r.stake,players:r.players.map(p=>({name:p.name,seat:p.seat,jid:p.jid})),ludo:r.ludo,gameOver:r.finished,winnerJid:r.winnerJid,gameResult:r.finished?(r.winnerJid?'finished':'void'):'playing'};}
function state(r){return r.game==='chess'?chessState(r):ludoState(r);}
function notify(r){broadcast(r,state(r));}
function roomUrl(req,r,p){const host=req.get('x-forwarded-host')||req.get('host');const proto=req.get('x-forwarded-proto')||'https';const file=r.game==='ludo'?'ludo.html':'catur.html';return `${proto}://${host}/${file}?room=${r.code}&token=${p.token}`;}
function addPlayer(r,jid,name){if(r.players.length >= (r.game==='chess'?2:4))return null;let p=jid?r.players.find(x=>x.jid===jid):null;if(p)return p;p={jid,token:token(),name:cleanName(name||'Pemain'),seat:r.players.length,ws:null};r.players.push(p);if(r.game==='ludo')r.ludo.players.push({seat:p.seat,tokens:[-1,-1,-1,-1],finished:0});return p;}
app.post('/api/wager/create',apiAuth,(req,res)=>{
 const game=req.body.game==='ludo'?'ludo':req.body.game==='chess'?'chess':null;const stake=Number(req.body.stake);const jid=String(req.body.jid||'');
 if(!game||!Number.isSafeInteger(stake)||stake<1||stake>100000000||!safeJid(jid))return res.status(400).json({ok:false,error:'game, stake, atau jid tidak valid.'});
 if(rooms.size>1000)return res.status(503).json({ok:false,error:'Server penuh.'});
 const r=createRoom(game,stake,jid);const p=r.players[0];res.status(201).json({ok:true,roomCode:r.code,token:p.token,url:roomUrl(req,r,p),game,stake});
});
app.post('/api/wager/join',apiAuth,(req,res)=>{
 const room=rooms.get(String(req.body.roomCode||'').toUpperCase());const jid=String(req.body.jid||'');const stake=Number(req.body.stake);
 if(!room)return res.status(404).json({ok:false,error:'Room tidak ditemukan.'});
 if(!safeJid(jid)||!Number.isSafeInteger(stake)||stake!==room.stake)return res.status(400).json({ok:false,error:'Identitas atau nominal taruhan tidak cocok.'});
 if(room.finished)return res.status(409).json({ok:false,error:'Game sudah selesai.'});
 if(room.players.some(p=>p.jid===jid))return res.status(409).json({ok:false,error:'Kamu sudah terdaftar di room ini.'});
 const p=addPlayer(room,jid,req.body.name||'Pemain');if(!p)return res.status(409).json({ok:false,error:'Room sudah penuh.'});
 room.lastActivity=Date.now();notify(room);res.status(201).json({ok:true,roomCode:room.code,token:p.token,url:roomUrl(req,room,p),game:room.game,stake:room.stake});
});
app.get('/api/wager/status/:code',apiAuth,(req,res)=>{const r=rooms.get(req.params.code.toUpperCase());if(!r)return res.status(404).json({ok:false,error:'Room tidak ditemukan.'});res.json({ok:true,roomCode:r.code,game:r.game,stake:r.stake,players:r.players.map(p=>({jid:p.jid,name:p.name,seat:p.seat})),finished:r.finished,winnerJid:r.winnerJid,claimed:r.claimed});});
app.post('/api/wager/refund',apiAuth,(req,res)=>{const r=rooms.get(String(req.body.roomCode||'').toUpperCase());const jid=String(req.body.jid||'');if(!r)return res.status(404).json({ok:false,error:'Room tidak ditemukan.'});if(!r.finished||r.winnerJid)return res.status(409).json({ok:false,error:'Refund hanya tersedia jika game seri atau dibatalkan.'});if(!r.players.some(p=>p.jid===jid))return res.status(403).json({ok:false,error:'Kamu tidak terdaftar sebagai pemain.'});if(r.refunded.has(jid))return res.status(409).json({ok:false,error:'Taruhan sudah direfund.'});r.refunded.add(jid);res.json({ok:true,refund:r.stake,roomCode:r.code});});
app.post('/api/wager/claim',apiAuth,(req,res)=>{const r=rooms.get(String(req.body.roomCode||'').toUpperCase());const jid=String(req.body.jid||'');if(!r)return res.status(404).json({ok:false,error:'Room tidak ditemukan.'});if(!r.finished||!r.winnerJid)return res.status(409).json({ok:false,error:'Game belum memiliki pemenang.'});if(jid!==r.winnerJid)return res.status(403).json({ok:false,error:'Hanya pemenang yang dapat klaim hadiah.'});if(r.claimed)return res.status(409).json({ok:false,error:'Hadiah room ini sudah diklaim.'});r.claimed=true;res.json({ok:true,prize:r.stake*r.players.length,roomCode:r.code,message:'Hadiah ditandai sudah diklaim.'});});
function attach(ws,r,p,name){p.ws=ws;p.name=cleanName(name||p.name);ws.roomCode=r.code;ws.playerToken=p.token;ws.seat=p.seat;r.lastActivity=Date.now();send(ws,{type:'joined',game:r.game,color:p.seat===0?'white':'black',seat:p.seat,roomCode:r.code,token:p.token,name:p.name});notify(r);}
function setWinner(r,seat){if(r.finished)return;r.finished=true;const p=r.players[seat];r.winnerJid=p?.jid||null;r.lastActivity=Date.now();broadcast(r,{type:'notice',message:`Game selesai. Pemenang: ${p?.name||'tidak diketahui'}. Hadiah diklaim dengan command .claimgame ${r.code}`});notify(r);}
function finishChess(r){const c=r.chess;if(c.isCheckmate()){const seat=c.turn()==='w'?1:0;setWinner(r,seat);}else if(c.isDraw()||c.isStalemate()||c.isInsufficientMaterial()){r.finished=true;r.winnerJid=null;broadcast(r,{type:'notice',message:'Game seri. Versi ini belum punya refund otomatis; hubungi owner bot untuk refund stake.'});notify(r);}}
const TRACK=52;
function handleLudo(r,p,msg){const g=r.ludo;if(r.finished)return send(p.ws,{type:'error',message:'Game sudah selesai.'});if(r.players.length<2)return send(p.ws,{type:'error',message:'Minimal 2 pemain harus masuk sebelum roll.'});if(p.seat!==g.turn)return send(p.ws,{type:'error',message:'Belum giliran kamu.'});
 if(msg.type==='roll'){
  if(g.dice!==null)return send(p.ws,{type:'error',message:'Pilih bidak untuk memakai dadu yang sudah keluar.'});
  const d=1+Math.floor(Math.random()*6);g.dice=d;g.lastRoll={seat:p.seat,dice:d};broadcast(r,{type:'notice',message:`${p.name} mendapat dadu ${d}.`});notify(r);return;
 }
 if(msg.type==='tokenMove'){
  if(g.dice===null)return send(p.ws,{type:'error',message:'Roll dadu dulu.'});const idx=Number(msg.tokenIndex);if(!Number.isInteger(idx)||idx<0||idx>3)return send(p.ws,{type:'error',message:'Bidak tidak valid.'});const pp=g.players[p.seat];let pos=pp.tokens[idx];const d=g.dice;
  if(pos===-1){if(d!==6)return send(p.ws,{type:'error',message:'Untuk keluar dari rumah, dadu harus 6.'});pos=0;}else{pos+=d;if(pos>57)return send(p.ws,{type:'error',message:'Dadu terlalu besar untuk mencapai finish.'});}
  pp.tokens[idx]=pos;if(pos===57)pp.finished++;
  // Shared track collision: send opponent token back home.
  if(pos>=0&&pos<52){for(const op of g.players){if(op.seat===p.seat)continue;for(let i=0;i<4;i++){if(op.tokens[i]>=0&&op.tokens[i]<52&&op.tokens[i]===pos){op.tokens[i]=-1;broadcast(r,{type:'notice',message:`Bidak lawan kena tabrak dan kembali ke rumah.`});}}}}
  const rolledSix=d===6;g.dice=null;if(pp.finished===4){setWinner(r,p.seat);return;}g.turn=rolledSix?p.seat:(p.seat+1)%r.players.length;g.turn%=r.players.length;notify(r);return;
 }
}
wss.on('connection',ws=>{
 ws.roomCode=null;ws.playerToken=null;ws.seat=null;ws.isAlive=true;
 ws.on('pong',()=>ws.isAlive=true);
 ws.on('message',raw=>{let m;try{m=JSON.parse(raw.toString())}catch{return send(ws,{type:'error',message:'Pesan tidak valid.'})}if(!m||typeof m.type!=='string')return;
  if(m.type==='joinToken'){
   const r=rooms.get(String(m.code||'').toUpperCase());if(!r)return send(ws,{type:'error',message:'Room tidak ditemukan.'});const p=playerForToken(r,String(m.token||''));if(!p)return send(ws,{type:'error',message:'Token room tidak valid. Gunakan link yang dikirim bot.'});if(ws.roomCode)return send(ws,{type:'error',message:'Kamu sudah berada di room.'});if(p.ws&&p.ws!==ws&&p.ws.readyState===WebSocket.OPEN){try{p.ws.close(4001,'reconnect')}catch{}}attach(ws,r,p,m.name);return;
  }
  if(m.type==='create'){
   const r=createRoom('chess');const p=addPlayer(r,null,m.name);p.jid=null;attach(ws,r,p,m.name);return;
  }
  if(m.type==='join'){
   const r=rooms.get(String(m.code||'').toUpperCase());if(!r)return send(ws,{type:'error',message:'Room tidak ditemukan.'});if(r.game!=='chess')return send(ws,{type:'error',message:'Room ini bukan catur.'});if(r.stake>0)return send(ws,{type:'error',message:'Room taruhan hanya bisa dimasuki lewat link dari bot.'});const p=addPlayer(r,null,m.name);if(!p)return send(ws,{type:'error',message:'Room penuh.'});attach(ws,r,p,m.name);return;
  }
  if(m.type==='reconnect'){
   const r=rooms.get(String(m.code||'').toUpperCase());if(!r)return send(ws,{type:'error',message:'Room tidak ditemukan.'});const p=playerForToken(r,String(m.token||''));if(!p||(r.game==='chess'&&p.seat!== (m.color==='black'?1:0)))return send(ws,{type:'error',message:'Sesi sambung ulang tidak valid.'});if(p.ws&&p.ws!==ws&&p.ws.readyState===WebSocket.OPEN)try{p.ws.close(4001,'reconnect')}catch{}attach(ws,r,p,p.name);return;
  }
  if(!ws.roomCode)return send(ws,{type:'error',message:'Gabung room terlebih dahulu.'});const r=rooms.get(ws.roomCode);if(!r)return send(ws,{type:'error',message:'Room sudah berakhir.'});const p=r.players.find(x=>x.token===ws.playerToken);if(!p||p.ws!==ws)return;
  r.lastActivity=Date.now();
  if(r.game==='chess'){
   if(m.type==='move'){
    if(r.finished||r.chess.isGameOver())return send(ws,{type:'error',message:'Game sudah selesai.'});if(r.chess.turn()!==(p.seat===0?'w':'b'))return send(ws,{type:'error',message:'Belum giliran kamu.'});try{const mv=r.chess.move({from:String(m.from||''),to:String(m.to||''),promotion:String(m.promotion||'q')});if(!mv)return send(ws,{type:'error',message:'Langkah tidak sah.'});notify(r);finishChess(r)}catch{return send(ws,{type:'error',message:'Langkah tidak sah.'})}return;
   }
   if(m.type==='resign'){setWinner(r,1-p.seat);return;}
   if(m.type==='leave'){p.ws=null;ws.roomCode=null;send(ws,{type:'left'});notify(r);return;}
  }else{
   if(m.type==='roll'||m.type==='tokenMove')return handleLudo(r,p,m);
   if(m.type==='leave'){p.ws=null;ws.roomCode=null;send(ws,{type:'left'});notify(r);return;}
  }
 });
 ws.on('close',()=>{const r=rooms.get(ws.roomCode);if(!r)return;const p=r.players.find(x=>x.token===ws.playerToken);if(p&&p.ws===ws)p.ws=null;r.lastActivity=Date.now();});
 ws.on('error',()=>{});
});
setInterval(()=>{const now=Date.now();for(const [k,r] of rooms){if(now-r.lastActivity>12*60*60*1000)rooms.delete(k)}},30*60*1000).unref();
setInterval(()=>{for(const ws of wss.clients){if(ws.isAlive===false){ws.terminate();continue;}ws.isAlive=false;try{ws.ping()}catch{ws.terminate()}}},25000).unref();
server.listen(PORT,'0.0.0.0',()=>console.log(`game-botwhatsapp listening on ${PORT}`));
