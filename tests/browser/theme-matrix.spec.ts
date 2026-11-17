import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Page} from "@playwright/test";
import {createHash} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {zipSync,strToU8} from "fflate";
import {sampleMeeting, type MemoItem} from "../../src/domain/model";

test.use({serviceWorkers:"block",reducedMotion:"reduce"});

async function prepare(page: Page) {
  await page.context().route("https://**/*", route => route.abort());
  await page.addInitScript(() => {
    const positions = new WeakMap<HTMLMediaElement, number>();
    Object.defineProperty(HTMLMediaElement.prototype,"currentTime",{configurable:true,
      get() {return positions.get(this) ?? 0;}, set(value:number) {positions.set(this,value);},
    });
    for (const type of ["error","playing","waiting","pause","ended","timeupdate","seeked"]) {
      document.addEventListener(type,event=>{if(event.isTrusted && event.target instanceof HTMLMediaElement) event.stopImmediatePropagation();},true);
    }
    HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("Synthetic in-page view"));
    Object.defineProperty(HTMLMediaElement.prototype,"error",{configurable:true,get:()=>null});
    HTMLMediaElement.prototype.play = function() {
      Object.defineProperty(this,"paused",{configurable:true,value:false});
      this.dispatchEvent(new Event("play")); this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function() {
      Object.defineProperty(this,"paused",{configurable:true,value:true}); this.dispatchEvent(new Event("pause"));
    };
  });
  const meeting = sampleMeeting();
  meeting.title = "Synthetic theme acceptance";
  meeting.synthetic = true;
  meeting.speakers[0].confirmed = true;
  meeting.segments = meeting.segments.map((segment,index)=>({...segment,
    start:index === 4 ? null : index*2, end:index === 4 ? null : index*2+1.6,
  }));
  meeting.segments[0].speakerIds = meeting.speakers.map(speaker=>speaker.id);
  const first = meeting.segments[0];
  const item: MemoItem = {id:crypto.randomUUID(),type:"summary",text:"Review the exact saved evidence before accepting the budget.",ownerId:null,dueDate:null,dueOriginal:null,sources:[{id:first.id,revision:first.revision}],review:"pending"};
  meeting.memos = [{id:crypto.randomUUID(),createdAt:new Date().toISOString(),sourceRevision:meeting.revision,model:"synthetic",items:[item,{...item,id:crypto.randomUUID(),type:"action",text:"Confirm the next review date.",review:"accepted"}],originalItems:[]}];
  meeting.memos[0].originalItems = structuredClone(meeting.memos[0].items);
  const audio = Buffer.alloc(44 + 16000 * 12);
  audio.write("RIFF");audio.writeUInt32LE(audio.length-8,4);audio.write("WAVEfmt ",8);audio.writeUInt32LE(16,16);
  audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write("data",36);audio.writeUInt32LE(audio.length-44,40);
  meeting.audio = {name:"theme.wav",type:"audio/wav",size:audio.length,duration:12,hash:createHash("sha256").update(audio).digest("hex"),present:true};
  await page.goto("./");
  page.once("dialog", confirmation=>confirmation.accept());
  await page.getByLabel("Restore backup",{exact:true}).setInputFiles({name:"theme.zip",mimeType:"application/zip",buffer:Buffer.from(zipSync({"meeting.json":strToU8(JSON.stringify(meeting)),"recording.bin":audio}))});
  await expect(page.getByRole("heading",{name:meeting.title+" (restored)",exact:true})).toBeVisible();
  const hash = new URL(page.url()).hash;
  return {meeting, hash};
}

async function appearance(page: Page, theme: string, palette: string) {
  await page.evaluate(({theme,palette}) => {
    for (const [key,value] of [["meeting-memo:theme",theme],["meeting-memo:palette",palette]]) {
      localStorage.setItem(key,value); window.dispatchEvent(new StorageEvent("storage",{key}));
    }
  },{theme,palette});
  await expect(page.locator("html")).toHaveAttribute("data-theme",theme);
  await expect(page.locator("html")).toHaveAttribute("data-palette",palette);
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation=>animation.finished.catch(()=>undefined)));
  });
}

for (const width of [390,768,1440])
  for (const view of ["library","settings","appearance","storage","about","transcript","speakers","playback","memo","immersive"] as const)
    test(`theme matrix ${view} at ${width}px`, async ({page},info) => {
      test.setTimeout(120000);
      await page.setViewportSize({width,height:1000});
      const {hash} = await prepare(page);
      const base = "/PWA-AI-Meeting-Memo-BYOK/";
      if (view === "library") await page.goto(base);
      else if (view === "settings" || view === "appearance" || view === "storage" || view === "about") {
        await page.goto(base+"#/settings");
        if (view === "appearance") await page.getByRole("tab",{name:"Appearance",exact:true}).click();
        if (view === "storage") await page.getByRole("tab",{name:"Storage",exact:true}).click();
        if (view === "about") await page.getByRole("tab",{name:"About",exact:true}).click();
      }
      else {
        await page.goto(base+hash);
        await page.getByRole("tab",{name: view === "transcript" ? /Transcript/ : view === "memo" ? /Meeting notes/ : /Speakers/}).click();
        if (view === "immersive" || view === "playback") {
          await expect(page.locator("audio")).toHaveAttribute("src",/^blob:/);
          await page.locator("audio").evaluate(element => {
            Object.defineProperty(element,"duration",{configurable:true,value:12});
            (element as HTMLMediaElement).currentTime=0.5;
            element.dispatchEvent(new Event("loadedmetadata"));element.dispatchEvent(new Event("seeked"));
          });
          if (view === "immersive") await page.getByRole("button",{name:"Immersive playback",exact:true}).click();
          else await page.getByRole("button",{name:"Playback mode",exact:true}).click();
          const controls = page.locator(view === "immersive" ? ".immersive" : ".audio-player");
          await controls.getByRole("button",{name:"Play audio",exact:true}).click();
          await expect(controls.getByRole("button",{name:"Pause audio",exact:true})).toBeVisible();
        }
      }
      await page.mouse.move(0,0);
      const manualReview: {state:string;rule:string;targets:string[][]}[] = [];
      const scan = async (label:string) => {
        const results = await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag22aa"]).analyze();
        expect(results.incomplete.filter(result=>result.id === "aria-prohibited-attr"),label+" unresolved ARIA authoring").toEqual([]);
        manualReview.push(...results.incomplete.map(result=>({state:label,rule:result.id,targets:result.nodes.map(node=>node.target.map(String))})));
        expect(results.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),label).toEqual([]);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+" overflow").toBe(true);
      };
      for (const theme of ["light","dark"])
        for (const palette of ["forest","ocean","violet","amber"]) {
          await appearance(page,theme,palette);
          await scan(`${view}/${width}/${theme}/${palette}`);
          if (palette === "forest") await page.screenshot({path:info.outputPath(`${view}-${width}-${theme}-forest.png`)});
          if (view === "library") {
            await page.locator("main").getByRole("button",{name:"New meeting",exact:true}).click();
            await scan(`new meeting/${width}/${theme}/${palette}`);
            await page.keyboard.press("Escape");
          }
        }
      await page.screenshot({path:info.outputPath(`${view}-${width}-dark.png`)});
      const reviewPath = info.outputPath("axe-manual-review.json");
      await writeFile(reviewPath,JSON.stringify(manualReview,null,2));
      await info.attach("axe-manual-review",{path:reviewPath,contentType:"application/json"});
    });
