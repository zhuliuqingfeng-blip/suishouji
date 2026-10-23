import {LunarUtil,LunarYear,Solar} from 'lunar-typescript';

// Product support is explicitly bounded by LUNAR year, including its days in
// the following Gregorian January/February. Never extrapolate beyond this range.
export const LUNAR_MIN_YEAR=1900;
export const LUNAR_MAX_YEAR=2100;
export const LUNAR_RANGE=`${LUNAR_MIN_YEAR}—${LUNAR_MAX_YEAR}`;
export interface CalendarDate {year:number;month:number;day:number}
export interface LunarDate extends CalendarDate {isLeapMonth:boolean}
export interface LunarMonthInfo {month:number;isLeapMonth:boolean;days:number;firstJulianDay:number}
const years=new Map<number,readonly LunarMonthInfo[]>();
export function lunarMonths(year:number):readonly LunarMonthInfo[] {
  if(!Number.isInteger(year)||year<LUNAR_MIN_YEAR||year>LUNAR_MAX_YEAR)return [];
  let months=years.get(year);
  if(!months){
    months=LunarYear.fromYear(year).getMonthsInYear().map(m=>({month:Math.abs(m.getMonth()),isLeapMonth:m.isLeap(),days:m.getDayCount(),firstJulianDay:m.getFirstJulianDay()}));
    years.set(year,months);
  }
  return months;
}
export function lunarToSolar(year:number,month:number,day:number,isLeapMonth=false):CalendarDate|null {
  const found=lunarMonths(year).find(m=>m.month===month&&m.isLeapMonth===isLeapMonth);
  if(!found||!Number.isInteger(day)||day<1||day>found.days)return null;
  const solar=Solar.fromJulianDay(found.firstJulianDay+day-1);
  return {year:solar.getYear(),month:solar.getMonth(),day:solar.getDay()};
}
export function solarToLunar(year:number,month:number,day:number):LunarDate|null {
  if(!Number.isInteger(year)||year<1900||year>2101||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>31)return null;
  const solar=Solar.fromYmd(year,month,day);
  // Solar.fromYmd does not validate every nonexistent Gregorian day itself.
  if(solar.getYear()!==year||solar.getMonth()!==month||solar.getDay()!==day)return null;
  const lunar=solar.getLunar(),y=lunar.getYear();
  if(y<LUNAR_MIN_YEAR||y>LUNAR_MAX_YEAR)return null;
  const result={year:y,month:Math.abs(lunar.getMonth()),day:lunar.getDay(),isLeapMonth:lunar.getMonth()<0};
  const back=lunarToSolar(result.year,result.month,result.day,result.isLeapMonth);
  return back&&back.year===year&&back.month===month&&back.day===day?result:null;
}
export function lunarMonthName(month:number,isLeapMonth=false):string {return `${isLeapMonth?'闰':''}${LunarUtil.MONTH[month]}月`;}
export function lunarDayName(day:number):string {return LunarUtil.DAY[day];}
let allMonthOptions:readonly {month:number;isLeapMonth:boolean}[]|undefined;
export function lunarMonthOptions(year:number|null):readonly {month:number;isLeapMonth:boolean}[] {
  if(year!==null)return lunarMonths(year);
  if(!allMonthOptions){
    const leap=new Set<number>();
    for(let y=LUNAR_MIN_YEAR;y<=LUNAR_MAX_YEAR;y++)for(const m of lunarMonths(y))if(m.isLeapMonth)leap.add(m.month);
    allMonthOptions=Array.from({length:12},(_,i)=>[{month:i+1,isLeapMonth:false},...(leap.has(i+1)?[{month:i+1,isLeapMonth:true}]:[])]).flat();
  }
  return allMonthOptions;
}
