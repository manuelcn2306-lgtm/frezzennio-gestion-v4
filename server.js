const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database(process.env.DB_FILE || path.join(__dirname, 'frezzennio.db'));

app.set('trust proxy', 1);

db.pragma('foreign_keys=ON');
db.pragma('journal_mode=WAL');

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'CAMBIAR-ESTE-SECRETO',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12
  }
}));

const auth=(req,res,next)=>req.session.user?next():res.status(401).json({error:'No autenticado'});
const code=(p,t)=>p+'-'+String((db.prepare(`select coalesce(max(id),0)+1 n from ${t}`).get().n)).padStart(4,'0');

function invCost(id){
  let p=db.prepare('select unit_cost from purchases where ingredient_id=? order by date desc,id desc limit 1').get(id);
  return p?.unit_cost??db.prepare('select base_cost from ingredients where id=?').get(id)?.base_cost??0;
}

function recipeCost(pid){
  let p=db.prepare('select * from products where id=?').get(pid);
  if(!p)return 0;
  let raw=db.prepare('select ingredient_id,qty from recipe_items where product_id=?').all(pid).reduce((s,r)=>s+r.qty*invCost(r.ingredient_id),0);
  return(raw*(1+p.waste_pct/100)+p.pack_cost+p.other_cost)/p.yield_qty;
}

function finishedStock(pid){
  let made=db.prepare("select coalesce(sum(qty),0) n from production_orders where product_id=? and status='COMPLETED'").get(pid).n;
  let sold=db.prepare('select coalesce(sum(qty),0) n from sales where product_id=?').get(pid).n;
  return made-sold;
}

app.post('/api/login',(req,res)=>{
  let u=db.prepare('select * from users where username=? and active=1').get(req.body.username||'');
  if(!u||!bcrypt.compareSync(req.body.password||'',u.password_hash))return res.status(401).json({error:'Usuario o contraseña incorrectos'});
  req.session.user={id:u.id,username:u.username,role:u.role};
  res.json(req.session.user);
});

app.post('/api/logout',auth,(q,r)=>q.session.destroy(()=>r.json({ok:true})));
app.get('/api/me',auth,(q,r)=>r.json(q.session.user));

app.get('/api/state',auth,(q,r)=>{
  try {
    let products=db.prepare('select * from products where active=1 order by name').all().map(p=>({...p,cost:recipeCost(p.id),stock:finishedStock(p.id),ingredients:db.prepare('select ri.*,i.name,i.unit from recipe_items ri join ingredients i on i.id=ri.ingredient_id where product_id=?').all(p.id)}));
    r.json({
      ingredients:db.prepare('select * from ingredients order by name').all().map(i=>({...i,current_cost:invCost(i.id)})),
      products,
      suppliers:db.prepare('select * from suppliers order by name').all(),
      clients:db.prepare('select * from clients order by name').all(),
      orders:db.prepare('select o.*,p.name product_name from production_orders o join products p on p.id=o.product_id order by o.id desc limit 100').all(),
      cash:db.prepare('select * from cash_movements order by id desc limit 100').all(),
      sales:db.prepare('select s.*,p.name product_name from sales s join products p on p.id=s.product_id order by s.id desc limit 100').all(),
      expenses:db.prepare('select * from expenses order by id desc limit 100').all()
    });
  } catch(e) {
    console.error('Error /api/state:',e);
    r.status(500).json({error:e.message});
  }
});

app.post('/api/ingredients',auth,(q,r)=>{
  try {
    let x=q.body,c=code('ING','ingredients');
    let z=db.prepare('insert into ingredients(code,name,unit,stock,min_stock,base_cost) values(?,?,?,?,?,?)').run(c,x.name,x.unit,+x.stock||0,+x.min_stock||0,+x.base_cost||0);
    r.json({id:z.lastInsertRowid,code:c});
  } catch(e) { r.status(400).json({error:e.message}); }
});

app.post('/api/purchases',auth,(q,r)=>{
  try {
    let x=q.body,uc=+x.total/+x.qty;
    let tx=db.transaction(()=>{
      let z=db.prepare('insert into purchases(date,ingredient_id,qty,total,supplier_id,unit_cost,created_by) values(?,?,?,?,?,?,?)').run(x.date,+x.ingredient_id,+x.qty,+x.total,x.supplier_id||null,uc,q.session.user.id);
      db.prepare('update ingredients set stock=stock+?,updated_at=CURRENT_TIMESTAMP where id=?').run(+x.qty,+x.ingredient_id);
      db.prepare("insert into stock_movements(date,ingredient_id,type,qty,ref_type,ref_id,user_id) values(?,?,?,?,?,?,?)").run(x.date,+x.ingredient_id,'IN',+x.qty,'PURCHASE',z.lastInsertRowid,q.session.user.id);
      db.prepare("insert into cash_movements(date,account,type,concept,amount,ref_type,ref_id,created_by) values(?,?,?,?,?,?,?,?)").run(x.date,x.account||'Caja','OUT','Compra de materia prima',+x.total,'PURCHASE',z.lastInsertRowid,q.session.user.id);
      return z.lastInsertRowid;
    });
    r.json({id:tx()});
  } catch(e) { r.status(400).json({error:e.message}); }
});

app.post('/api/products',auth,(q,r)=>{
  try {
    let x=q.body,c=code('PRD','products');
    let tx=db.transaction(()=>{
      let z=db.prepare('insert into products(code,name,yield_qty,price,pack_cost,other_cost,waste_pct) values(?,?,?,?,?,?,?)').run(c,x.name,+x.yield_qty,+x.price,+x.pack_cost||0,+x.other_cost||0,+x.waste_pct||0);
      let st=db.prepare('insert into recipe_items(product_id,ingredient_id,qty) values(?,?,?)');
      (x.ingredients||[]).forEach(i=>st.run(z.lastInsertRowid,+i.ingredient_id,+i.qty));
      return z.lastInsertRowid;
    });
    r.json({id:tx(),code:c});
  } catch(e) { r.status(400).json({error:e.message}); }
});

app.post('/api/orders',auth,(q,r)=>{
  try {
    let x=q.body,c=code('OP','production_orders');
    let z=db.prepare("insert into production_orders(code,date,product_id,qty,status,created_by) values(?,?,?,?, 'PLANNED',?)").run(c,x.date,+x.product_id,+x.qty,q.session.user.id);
    r.json({id:z.lastInsertRowid,code:c});
  } catch(e) { r.status(400).json({error:e.message}); }
});

app.post('/api/orders/:id/complete',auth,(q,r)=>{
  let id=+q.params.id;
  try {
    let tx=db.transaction(()=>{
      let o=db.prepare('select * from production_orders where id=?').get(id);
      if(!o||o.status!=='PLANNED')throw Error('Orden no disponible');
      let p=db.prepare('select * from products where id=?').get(o.product_id);
      let items=db.prepare('select * from recipe_items where product_id=?').all(p.id);
      let batches=o.qty/p.yield_qty,total=0;
      for(let it of items){
        let need=it.qty*batches,ing=db.prepare('select * from ingredients where id=?').get(it.ingredient_id);
        if(ing.stock<need)throw Error('Stock insuficiente: '+ing.name);
        let uc=invCost(it.ingredient_id),tc=need*uc;
        total+=tc;
        db.prepare('update ingredients set stock=stock-? where id=?').run(need,it.ingredient_id);
        db.prepare('insert into production_cost_trace(order_id,ingredient_id,qty_used,unit_cost_snapshot,total_cost) values(?,?,?,?,?)').run(id,it.ingredient_id,need,uc,tc);
        db.prepare("insert into stock_movements(date,ingredient_id,type,qty,ref_type,ref_id,user_id) values(?,?,?,?,?,?,?)").run(o.date,it.ingredient_id,'OUT',need,'PRODUCTION',id,q.session.user.id);
      }
      total=total*(1+p.waste_pct/100)+p.pack_cost*batches+p.other_cost*batches;
      db.prepare("update production_orders set status='COMPLETED',unit_cost=?,total_cost=?,completed_at=CURRENT_TIMESTAMP where id=?").run(total/o.qty,total,id);
    });
    tx();
    r.json({ok:true});
  } catch(e) { r.status(400).json({error:e.message}); }
});

app.post('/api/sales',auth,(q,r)=>{
  try {
    let x=q.body,pid=+x.product_id,qty=+x.qty;
    if(finishedStock(pid)<qty)return r.status(400).json({error:'Stock de producto terminado insuficiente'});
    let cost=recipeCost(pid);
    let tx=db.transaction(()=>{
      let z=db.prepare('insert into sales(date,product_id,qty,unit_price,total,payment_method,client_id,unit_cost_snapshot,created_by) values(?,?,?,?,?,?,?,?,?)').run(x.date,pid,qty,+x.unit_price,qty*+x.unit_price,x.payment_method,x.client_id||null,cost,q.session.user.id);
      if(x.payment_method!=='Crédito')db.prepare("insert into cash_movements(date,account,type,concept,amount,ref_type,ref_id,created_by) values(?,?,?,?,?,?,?,?)").run(x.date,x.account||'Caja','IN','Venta',qty*+x.unit_price,'SALE',z.lastInsertRowid,q.session.user.id);
      return z.lastInsertRowid;
    });
    r.json({id:tx()});
  } catch(e) { r.status(400).json({error:e.message}); }
});

app.post('/api/expenses',auth,(q,r)=>{
  try {
    let x=q.body;
    let tx=db.transaction(()=>{
      let z=db.prepare('insert into expenses(date,concept,type,amount,payment_method,created_by) values(?,?,?,?,?,?)').run(x.date,x.concept,x.type,+x.amount,x.payment_method,q.session.user.id);
      db.prepare("insert into cash_movements(date,account,type,concept,amount,ref_type,ref_id,created_by) values(?,?,?,?,?,?,?,?)").run(x.date,x.account||'Caja','OUT',x.concept,+x.amount,'EXPENSE',z.lastInsertRowid,q.session.user.id);
      return z.lastInsertRowid;
    });
    r.json({id:tx()});
  } catch(e) { r.status(400).json({error:e.message}); }
});

app.use(express.static(path.join(__dirname,'public')));

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('FREZZENNIO V4 http://localhost:'+PORT));
