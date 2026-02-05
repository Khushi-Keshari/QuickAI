
import OpenAI from "openai"
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import axios from "axios";
import {v2 as cloudinary} from 'cloudinary';
import FormData from "form-data";
import fs from 'fs';
import pdf from 'pdf-parse-fork';
// import pdf from 'pdf-parse/lib/pdf-parse.js';
// import * as pdf from 'pdf-parse';
// import { createRequire } from 'module';
// const require = createRequire(import.meta.url);
// const pdfLib = require('pdf-parse');

const AI = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
});

export const generateArticle = async (req,res)=> {
    try {
        const {userId} =req.auth();
       
        const {prompt, length} = req.body;
        
        const plan =req.plan;
        const free_usage=req.free_usage;
        if(plan!== 'premium' && free_usage>=10){
            return res.json({success: false,message: "Limit reached. Upgrade to continue."})
        }
        
        const response = await AI.chat.completions.create({
            model: "gemini-2.5-flash",
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
            temperature: 0.7,
            max_tokens:length*10,
        });

        const content= response.choices[0].message.content
        await sql`INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId},${prompt},${content},'article')`;
        if(plan!=='premium'){
            await clerkClient.users.updateUserMetadata(userId,{
                privateMetadata: {
                    free_usage: free_usage+1
                }
            })
        }

        res.json({success: true,content});

    } catch (error) {
        console.log(error.message)
        res.json({success: false, message: error.message})
    }
}



export const generateBlogTitle = async (req,res)=> {
    try {
        const {userId} =req.auth();
        const {prompt} = req.body;
        const plan =req.plan;
        const free_usage=req.free_usage;
        if(plan!== 'premium' && free_usage>=10){
            return res.json({success: false,message: "Limit reached. Upgrade to continue."})
        }

        const response = await AI.chat.completions.create({
            model: "gemini-2.5-flash",
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
            temperature: 0.7,
            max_tokens:1500,
        });

        const content= response.choices[0].message.content
        await sql`INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId},${prompt},${content},'blog-title')`;
        if(plan!=='premium'){
            await clerkClient.users.updateUserMetadata(userId,{
                privateMetadata: {
                    free_usage: free_usage+1
                }
            })
        }

        res.json({success: true,content});

    } catch (error) {
        console.log(error.message)
        res.json({success: false, message: error.message})
    }
}




export const generateImage = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt, publish } = req.body;
    const plan = req.plan;

    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is only available for premium subscriptions",
      });
    }

    // Prepare FormData for ClipDrop
    const formData = new FormData();
    formData.append("prompt", prompt);

    // Post to ClipDrop
    const response = await axios.post(
      "https://clipdrop-api.co/text-to-image/v1",
      formData,
      {
        headers: {
          "x-api-key": process.env.CLIPDROP_API_KEY,
          ...formData.getHeaders(), // very important for FormData
        },
        responseType: "arraybuffer",
      }
    );

    // Convert to base64
    const base64Image = `data:image/png;base64,${Buffer.from(
      response.data,
      "binary"
    ).toString("base64")}`;

    // Upload to Cloudinary
    const cloudResponse = await cloudinary.uploader.upload(base64Image);

    // Save in DB
    await sql`INSERT INTO creations (user_id, prompt, content, type, publish) 
               VALUES (${userId}, ${prompt}, ${cloudResponse.secure_url}, 'image', ${publish ?? false})`;

    res.json({ success: true, content: cloudResponse.secure_url });
  } catch (error) {
    console.log("Full Error:", error);

    // Handle Axios errors separately
    if (error.response) {
      // Server responded with a status code outside 2xx
      console.log("Axios Response Error:", error.response.data);
      return res.json({
        success: false,
        message: error.response.data || error.message,
        status: error.response.status,
      });
    }

    res.json({
      success: false,
      message: error.message || "Unknown error occurred",
    });
  }
};




export const removeImageBackground= async (req, res) => {
  try {
    const { userId } = req.auth();
    const image=req.file;
    const plan = req.plan;

    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is only available for premium subscriptions",
      });
    }

    
    const cloudResponse = await cloudinary.uploader.upload(image.path,{
        transformation: [
            {
                effect: 'background_removal',
                background_removal: 'remove_the_background'
            }
        ]
    });

    // Save in DB
    await sql`INSERT INTO creations (user_id, prompt, content, type) 
               VALUES (${userId}, 'Remove background from image', ${cloudResponse.secure_url}, 'image')`;

    res.json({ success: true, content: cloudResponse.secure_url });
  } catch (error) {
    console.log("Full Error:", error);

    // Handle Axios errors separately
    if (error.response) {
      // Server responded with a status code outside 2xx
      console.log("Axios Response Error:", error.response.data);
      return res.json({
        success: false,
        message: error.response.data || error.message,
        status: error.response.status,
      });
    }

    res.json({
      success: false,
      message: error.message || "Unknown error occurred",
    });
  }
};





export const removeImageObject= async (req, res) => {
  try {
    const { userId } = req.auth();
    const { object } = req.body;
    const image=req.file;
    const plan = req.plan;


    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is only available for premium subscriptions",
      });
    }

    
    const {public_id}= await cloudinary.uploader.upload(image.path);
    const imageUrl=cloudinary.url(public_id,{
        transformation: [{
            effect: `gen_remove:prompt_${object}`
        }],
        secure:true,
        resource_type: 'image',
        version: Math.floor(Date.now() / 1000)
    })

    // Save in DB
    await sql`INSERT INTO creations (user_id, prompt, content, type) 
               VALUES (${userId}, ${`Remove ${object} from image`}, ${imageUrl}, 'image')`;

    res.json({ success: true, content: imageUrl });
  } catch (error) {
    console.log("Full Error:", error);

    // Handle Axios errors separately
    if (error.response) {
      // Server responded with a status code outside 2xx
      console.log("Axios Response Error:", error.response.data);
      return res.json({
        success: false,
        message: error.response.data || error.message,
        status: error.response.status,
      });
    }

    res.json({
      success: false,
      message: error.message || "Unknown error occurred",
    });
  }
};




export const resumeReview= async (req, res) => {
  req.setTimeout(60000);
  console.log("PDF Library Type:", typeof pdfParse);
  try {
    const { userId } = req.auth();
    
    const resume=req.file;
    const plan = req.plan;


    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is only available for premium subscriptions",
      });
    }

    if(resume.size > 5*1024*1024){
        return res.json({success:false, message: "Resume file size exceeds allowed size (5MB)."})
    }
    

    const dataBuffer=fs.readFileSync(resume.path)

    const pdfData=await pdf(dataBuffer)
    fs.unlinkSync(resume.path);
    // const parsePdf = typeof pdf === 'function' ? pdf : pdf.default;
    const truncatedText = pdfData.text.replace(/\s+/g, ' ').trim().slice(0, 8000);
    // const pdfData = await (pdfParse.default ? pdfParse.default(dataBuffer) : pdfParse(dataBuffer));

    const prompt=`Review the following resume and provide constructive feedback on its strengths, weaknesses, and areas for improvement. Resume Content: \n\n${truncatedText}`

    const response = await AI.chat.completions.create({
        // model: "gemini-2.5-flash",
        // messages: [
        //     {
        //         role: "user",
        //         content: prompt,
        //     },
        // ],
        // temperature: 0.7,
        // max_tokens:1000,
        model: "gemini-3-flash-preview", // Use 1.5-flash for better stability/limits
      messages: [
        {
          role: "system",
          content: "You are an expert HR consultant. Provide a detailed resume review in Markdown format."
        },
        {
          role: "user",
          content: `Review this resume content: \n\n${truncatedText}`
        }
      ],
      temperature: 0.7,
      max_tokens: 2000, 
    });
    console.log("Finish Reason:", response.choices[0].finish_reason);
    const content= response.choices[0].message.content;
    
    // Save in DB
    await sql`INSERT INTO creations (user_id, prompt, content, type) 
               VALUES (${userId}, 'Review the uploaded resume', ${content}, 'resume-review')`;

    res.json({ success: true, content });
  } catch (error) {
    console.log("Full Error:", error);

    // Handle Axios errors separately
    if (error.response) {
      // Server responded with a status code outside 2xx
      console.log("Axios Response Error:", error.response.data);
      return res.json({
        success: false,
        message: error.response.data || error.message,
        status: error.response.status,
      });
    }

    res.json({
      success: false,
      message: error.message || "Unknown error occurred",
    });
  }
};

