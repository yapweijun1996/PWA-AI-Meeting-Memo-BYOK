import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";

/** Pure synthetic tones and authored labels: tests playback, never recognition quality. */
export function acceptanceFixture() {
  const rate=8000,seconds=8;
  const audio=Buffer.alloc(44+rate*seconds*2);
  audio.write("RIFF");audio.writeUInt32LE(audio.length-8,4);audio.write("WAVEfmt ",8);
  audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);
  audio.writeUInt32LE(rate,24);audio.writeUInt32LE(rate*2,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);
  audio.write("data",36);audio.writeUInt32LE(audio.length-44,40);
  for(let i=0;i<rate*seconds;i++) {
    const t=i/rate;
    const low=(t>=0.5 && t<2)||(t>=4.5 && t<5.5);
    const high=(t>=2.5 && t<4)||(t>=4.5 && t<5.5);
    const value=(low?Math.sin(2*Math.PI*220*t):0)+(high?Math.sin(2*Math.PI*440*t):0);
    audio.writeInt16LE(Math.round(value*0.15*32767),44+i*2);
  }
  const speakerIds=[randomUUID(),randomUUID()];
  const source=(text,speakerIds,start,end)=>({id:randomUUID(),revision:1,start,end,speakerIds,originalText:text,text,reviewed:false,parents:[]});
  const segments=[source("Synthetic low tone, not a human voice.",[speakerIds[0]],0.5,2),source("Synthetic high tone, not a human voice.",[speakerIds[1]],2.5,4),source("Synthetic overlapping tones, not overlapping speakers.",speakerIds,4.5,5.5),source("Untimed synthetic note; no invented audio position.",[],null,null)];
  const now=new Date().toISOString();
  const item={id:randomUUID(),type:"summary",text:"Synthetic playback demonstration only. Labels and timing are authored; no speech recognition or provider request occurred.",ownerId:null,dueDate:null,dueOriginal:null,sources:[{id:segments[0].id,revision:1}],review:"pending",reviewedRevision:null};
  const meeting={schemaVersion:2,version:0,id:randomUUID(),title:"Synthetic playback acceptance",date:now.slice(0,10),timezone:"UTC",languages:"English",attendees:[],glossary:"",kind:"general",createdAt:now,updatedAt:now,revision:1,synthetic:true,referenceVideo:null,speakers:speakerIds.map((id,i)=>({id,name:`Synthetic ${i===0?"low":"high"} tone`,confirmed:false,sourceLabels:["authored-synthetic-tone"]})),segments,history:[],undo:[],memos:[{id:randomUUID(),createdAt:now,sourceRevision:1,model:"Authored synthetic fixture; no model",items:[item],originalItems:[structuredClone(item)]}],jobs:[],audio:{name:"synthetic-tones-not-speech.wav",type:"audio/wav",size:audio.length,duration:seconds,hash:createHash("sha256").update(audio).digest("hex"),present:true},runs:[]};
  return zipSync({"meeting.json":strToU8(JSON.stringify(meeting)),"recording.bin":audio},{level:0});
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(!process.argv[2]) {console.error("Usage: node scripts/create-acceptance-fixture.mjs OUTPUT_DIRECTORY");process.exitCode=1;}
  else {
    try {
      const directory=path.resolve(process.argv[2]);await mkdir(directory,{recursive:true});
      await writeFile(path.join(directory,"synthetic-playback.zip"),acceptanceFixture(),{flag:"wx"});
      console.log("Created synthetic-playback.zip (tones only, no human voices, keys or provider calls). Existing files are never overwritten.");
    }catch {console.error("Fixture creation failed; use a writable directory without an existing synthetic-playback.zip.");process.exitCode=1;}
  }
}
