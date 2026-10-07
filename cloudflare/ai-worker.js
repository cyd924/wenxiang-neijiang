// Private inference service. No workers.dev route; accessed through a service binding.
export default {
  async fetch(request,env){
    if(request.method!=='POST')return new Response('Method not allowed',{status:405});
    try{
      const data=await request.json();
      if(!Array.isArray(data.messages)||data.messages.length!==2||data.messages.some(m=>!['system','user'].includes(m.role)||typeof m.content!=='string'||m.content.length>4000))return new Response('Invalid input',{status:400});
      const response=await env.AI.run('@cf/qwen/qwen3-30b-a3b-fp8',{messages:data.messages,temperature:0,max_tokens:650,response_format:{type:'json_object'}});
      return Response.json(response);
    }catch(error){console.error('inference_failed',String(error.message));return Response.json({error:'模型服务暂不可用'},{status:503});}
  }
};
