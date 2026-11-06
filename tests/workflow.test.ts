import { expect, test } from "vitest";
import { createMeeting, id } from "../src/domain/model";
import { getMeetingWorkflow, doesMeetingNeedReview, isMeetingCompleted } from "../src/domain/workflow";

test("workflow preserves unknown outcomes and source review requirements", () => {
 const m = createMeeting({ title: "Workflow" });
 expect(getMeetingWorkflow(m).cta[0]).toBe("Start");
 m.jobs.push({id:id(),stage:"memo",state:"outcome_unknown",billing:"possibly_charged",createdAt:"",updatedAt:"",requestId:null,message:"",inputRevision:m.revision});
 expect(getMeetingWorkflow(m).stage[0]).toBe("Outcome unknown");
 expect(doesMeetingNeedReview(m)).toBe(true);
 expect(isMeetingCompleted(m)).toBe(false);
 m.jobs[0].state="in_flight";
 expect(getMeetingWorkflow(m).cta[0]).toBe("View");
});
