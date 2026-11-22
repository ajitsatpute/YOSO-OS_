export type Role="member"|"pod_lead"|"account_manager"|"founder";
export type Craft="writer"|"editor"|"designer"|"account_manager";
export type Tier="intern"|"junior"|"standard"|"senior"|"lead";
export type HealthLabel="Healthy"|"Watch"|"At risk";
export type WorkItem={id:string;title:string;clientId:string;podId:string;craft:Craft;dueDate:string;estimatedHours:number;week:number;assignedTo?:string;status:"open"|"assigned"|"done";dependsOn?:string[]};
export type PlannerPerson={id:string;name:string;craft:Craft;tier:Tier;podId:string;podName?:string;weeklyHours:number;leaveWeeks:number[]};
