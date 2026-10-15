"use strict";
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const db = require("../db");
const requireAdmin = require("../auth/require-admin");
const router = express.Router();
const uploadDir = path.resolve(__dirname, "../private_writing_uploads");
const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1},fileFilter:(req,file,cb)=>cb(null,["image/jpeg","image/png","image/webp"].includes(file.mimetype))});
const fail=(res,status,message)=>res.status(status).json({success:false,message});
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const requireLogin=(req,res,next)=>req.session?.userId?next():fail(res,401,"Vui lòng đăng nhập.");
function formatDate(v){return new Date(v).toISOString().slice(0,19).replace("T"," ");}
function isValidLocalDate(s){return /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(s)&&!Number.isNaN(new Date(s).getTime());}
function imageType(b){if(b.length>3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return {mime:"image/jpeg",ext:"jpg"};if(b.length>8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:"image/png",ext:"png"};if(b.length>12&&b.toString("ascii",0,4)==="RIFF"&&b.toString("ascii",8,12)==="WEBP")return {mime:"image/webp",ext:"webp"};return null;}
function normalizeGrade(obj){
 const fields=["grammar_score","vocabulary_score","content_score","organization_score"];
 const values={};for(const f of fields){const n=Number(obj[f]);if(!Number.isInteger(n)||n<0||n>25)throw new Error("AI trả điểm không hợp lệ: "+f);values[f]=n;}
 if(typeof obj.extracted_text!=="string"||!obj.extracted_text.trim()||typeof obj.feedback!=="string"||!obj.feedback.trim())throw new Error("AI chưa đọc được bài viết rõ ràng. Hãy nộp ảnh nét hơn.");
 return {...values,score:fields.reduce((s,f)=>s+values[f],0),extracted_text:obj.extracted_text.slice(0,30000),feedback:obj.feedback.slice(0,10000),errors_json:JSON.stringify(Array.isArray(obj.errors)?obj.errors.slice(0,30):[])};
}
async function gradeImage(image,mime,assignment){
 const webhook=process.env.N8N_WRITING_WEBHOOK_URL;
 const secret=process.env.N8N_WRITING_SECRET;
 if(!webhook||!secret)throw new Error("Thiếu N8N_WRITING_WEBHOOK_URL hoặc N8N_WRITING_SECRET.");
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),90000);
 try{
  const response=await fetch(webhook,{
   method:"POST",headers:{"Content-Type":"application/json","x-writing-secret":secret},signal:controller.signal,
   body:JSON.stringify({assignment:{title:assignment.title,prompt:assignment.prompt,min_words:assignment.min_words,max_words:assignment.max_words},image:{mime_type:mime,base64:image.toString("base64")}})
  });
  if(!response.ok)throw new Error("n8n trả HTTP "+response.status);
  const payload=await response.json();
  return normalizeGrade(payload.grade||payload);
 }finally{clearTimeout(timeout);}
}
router.get("/assignments",requireLogin,wrap(async(req,res)=>{
 const [rows]=await db.query(`SELECT a.id,a.title,a.prompt,a.min_words,a.max_words,a.deadline, (NOW() > a.deadline) AS closed,s.id AS submission_id,s.status,s.score,s.feedback,s.extracted_text,s.grammar_score,s.vocabulary_score,s.content_score,s.organization_score,s.submitted_at FROM writing_assignments a LEFT JOIN writing_submissions s ON s.assignment_id=a.id AND s.user_id=? ORDER BY a.deadline DESC`,[req.session.userId]);
 res.json({success:true,data:rows});
}));
router.post("/assignments",requireLogin,requireAdmin,wrap(async(req,res)=>{
 const {title,prompt,min_words=50,max_words=300,deadline}=req.body||{};
 const min=Number(min_words),max=Number(max_words);
 if(typeof title!=="string"||!title.trim()||title.length>200||typeof prompt!=="string"||!prompt.trim()||prompt.length>10000||!Number.isInteger(min)||!Number.isInteger(max)||min<1||max>3000||max<min||!isValidLocalDate(deadline))return fail(res,400,"Thông tin đề bài không hợp lệ.");
 // datetime-local input is local time in Vietnam; require server TZ=Asia/Ho_Chi_Minh.
 const date=deadline.replace("T"," ")+":00";
 const [check]=await db.query("SELECT TIMESTAMPDIFF(SECOND,NOW(),?) AS remaining",[date]);
 if(check[0].remaining<=0)return fail(res,400,"Hạn nộp phải ở tương lai.");
 const [r]=await db.query("INSERT INTO writing_assignments(title,prompt,min_words,max_words,deadline,created_by) VALUES(?,?,?,?,?,?)",[title.trim(),prompt.trim(),min,max,date,req.session.userId]);
 res.status(201).json({success:true,data:{id:r.insertId}});
}));
router.get("/admin/submissions",requireLogin,requireAdmin,wrap(async(req,res)=>{
 const [rows]=await db.query(`SELECT a.id assignment_id,a.title,a.deadline,u.id user_id,u.full_name,u.email,s.id submission_id,s.status,s.score,s.submitted_at,s.feedback FROM writing_assignments a CROSS JOIN users u LEFT JOIN writing_submissions s ON s.assignment_id=a.id AND s.user_id=u.id WHERE u.role='student' ORDER BY a.deadline DESC,u.id ASC LIMIT 2000`);
 res.json({success:true,data:rows});
}));
router.post("/assignments/:id/submit",requireLogin,(req,res,next)=>upload.single("image")(req,res,err=>err?next(err):next()),wrap(async(req,res)=>{
 const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0)return fail(res,400,"ID đề bài không hợp lệ.");
 if(!req.file)return fail(res,400,"Hãy chọn ảnh JPG, PNG hoặc WEBP (tối đa 5MB).");
 const type=imageType(req.file.buffer);if(!type)return fail(res,400,"Tệp không phải ảnh hợp lệ.");
 const [rows]=await db.query("SELECT * FROM writing_assignments WHERE id=? AND deadline >= NOW() LIMIT 1",[id]);
 if(!rows.length)return fail(res,403,"Đề bài không tồn tại hoặc đã hết hạn.");
 await fs.mkdir(uploadDir,{recursive:true});
 const filename=crypto.randomUUID()+"."+type.ext;
 const filePath=path.join(uploadDir,filename);
 await fs.writeFile(filePath,req.file.buffer,{flag:"wx"});
 let submissionId;
 try{
  const [result]=await db.query(`INSERT INTO writing_submissions(assignment_id,user_id,image_path,image_mime,status) SELECT id,?,?,?,'grading' FROM writing_assignments WHERE id=? AND deadline >= NOW()`,[req.session.userId,filename,type.mime,id]);
  if(!result.affectedRows){await fs.unlink(filePath);return fail(res,403,"Đã hết hạn nộp.");}
  submissionId=result.insertId;
 }catch(error){await fs.unlink(filePath).catch(()=>{});if(error.code==="ER_DUP_ENTRY")return fail(res,409,"Bạn đã nộp bài này. Mỗi học sinh được nộp một lần.");throw error;}
 try{
  const grade=await gradeImage(req.file.buffer,type.mime,rows[0]);
  await db.query(`UPDATE writing_submissions SET status='graded',extracted_text=?,score=?,grammar_score=?,vocabulary_score=?,content_score=?,organization_score=?,feedback=?,errors_json=?,graded_at=NOW() WHERE id=?`,[grade.extracted_text,grade.score,grade.grammar_score,grade.vocabulary_score,grade.content_score,grade.organization_score,grade.feedback,grade.errors_json,submissionId]);
  res.status(201).json({success:true,data:{submission_id:submissionId,status:"graded",score:grade.score}});
 }catch(error){console.error("WRITING GRADE:",error.message);await db.query("UPDATE writing_submissions SET status='failed' WHERE id=?",[submissionId]);res.status(202).json({success:true,data:{submission_id:submissionId,status:"failed",message:"Đã nhận bài, nhưng AI chưa chấm được. Liên hệ Admin để xử lý."}});}
}));
router.get("/assignments/:id/ranking",requireLogin,wrap(async(req,res)=>{
 const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0)return fail(res,400,"ID không hợp lệ.");
 const [rows]=await db.query(`SELECT s.user_id,u.full_name,s.score,s.submitted_at FROM writing_submissions s JOIN users u ON u.id=s.user_id WHERE s.assignment_id=? AND s.status='graded' ORDER BY s.score DESC,s.submitted_at ASC,s.id ASC LIMIT 200`,[id]);
 res.json({success:true,data:rows.map((r,i)=>({rank:i+1,name:r.full_name||"Học sinh",score:r.score,is_me:Number(r.user_id)===Number(req.session.userId)}))});
}));
router.get("/submissions/:id/image",requireLogin,wrap(async(req,res)=>{
 const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0)return fail(res,400,"ID không hợp lệ.");
 const [rows]=await db.query("SELECT image_path,image_mime,user_id FROM writing_submissions WHERE id=? LIMIT 1",[id]);if(!rows.length)return fail(res,404,"Không tìm thấy ảnh.");
 if(Number(rows[0].user_id)!==Number(req.session.userId)){
  const [admin]=await db.query("SELECT role FROM users WHERE id=?",[req.session.userId]);
  if(admin[0]?.role!=="admin")return fail(res,403,"Không có quyền xem ảnh.");
 }
 res.type(rows[0].image_mime);res.set("Cache-Control","private, no-store");res.sendFile(path.join(uploadDir,path.basename(rows[0].image_path)));
}));
router.use((err,req,res,next)=>{
 if(err instanceof multer.MulterError)return fail(res,400,"Ảnh vượt giới hạn 5MB hoặc upload không hợp lệ.");
 next(err);
});
module.exports=router;
