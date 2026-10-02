import type {HiringApplicantFilters,HiringStage} from '../api/hiring';
export function toggleHiringStage(filters:HiringApplicantFilters,stage:HiringStage):HiringApplicantFilters{return {...filters,page:1,stage:filters.stage===stage?'':stage};}
export function defaultHiringFilters():HiringApplicantFilters{return {page:1,pageSize:20,status:'active'};}
export function hasHiringFilters(filters:HiringApplicantFilters,search=''){return Boolean(search.trim()||filters.search?.trim()||filters.stage||filters.position||filters.department||filters.ownerId||filters.assignedToMe||filters.status==='archived');}
