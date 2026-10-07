const Database=require('better-sqlite3'),fs=require('fs'),path=require('path'),bcrypt=require('bcryptjs');
const db=new Database(process.env.DB_FILE||path.join(__dirname,'frezzennio.db'));db.exec(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
const u=process.env.ADMIN_USER||'admin',p=process.env.ADMIN_PASSWORD||'Cambiar123!';
if(!db.prepare('select id from users where username=?').get(u)) db.prepare('insert into users(username,password_hash,role) values(?,?,?)').run(u,bcrypt.hashSync(p,12),'admin');
console.log('Base inicializada. Usuario:',u,'IMPORTANTE: cambia ADMIN_PASSWORD antes de producción.');
