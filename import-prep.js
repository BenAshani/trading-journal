// הדבק את כל הקובץ הזה בקונסול של הדפדפן
(function(){
  function uid(){ return Math.random().toString(36).slice(2,9); }
  const existing = JSON.parse(localStorage.getItem('tj-prep')||'[]');
  const existingTickers = existing.map(t=>t.ticker+t.createdAt);

  const imported = [
    {
      id:uid(), ticker:'TSLA', grade:'1',
      gradeNote:'ריבאונד, כניסה מעל 370.04, חזרה ל-372.13, כניסה מעל VWAP',
      qty:'140', stop:'43',
      createdAt: new Date('2026-04-30').getTime(),
      targets:[
        {id:uid(), target:'400',  sellQty:'70',  newStop:''},
        {id:uid(), target:'444',  sellQty:'35',  newStop:''},
        {id:uid(), target:'475',  sellQty:'35',  newStop:''},
      ]
    },
    {
      id:uid(), ticker:'LMND', grade:'2',
      gradeNote:'פוזיציה קצרה לאליגה, מחנכה לטף וכניסה מעל VWAP. גם לא יוצא חריסה, קפיצה ים - VWAP',
      qty:'123', stop:'81',
      createdAt: new Date('2026-05-06').getTime(),
      targets:[
        {id:uid(), target:'64',  sellQty:'61',  newStop:'58.2'},
        {id:uid(), target:'75',  sellQty:'31',  newStop:'62.55'},
        {id:uid(), target:'83',  sellQty:'31',  newStop:''},
      ]
    },
    {
      id:uid(), ticker:'CRCL', grade:'2',
      gradeNote:'מחנכת טנף וכניסה מסל VWAP, פריחה כבר VWAP',
      qty:'62', stop:'159',
      createdAt: new Date('2026-05-11').getTime(),
      targets:[
        {id:uid(), target:'130.5', sellQty:'31', newStop:'122.5'},
        {id:uid(), target:'147.5', sellQty:'15', newStop:'128'},
        {id:uid(), target:'162.5', sellQty:'16', newStop:''},
      ]
    },
    {
      id:uid(), ticker:'MITK', grade:'2',
      gradeNote:'פגיחה מסל אחרי סטיית קודם, מחנכה טנף וכניסה מסל VWAP',
      qty:'303', stop:'33',
      createdAt: new Date('2026-05-11').getTime() + 60000,
      targets:[
        {id:uid(), target:'18',   sellQty:'152', newStop:'15.7'},
        {id:uid(), target:'19.4', sellQty:'75',  newStop:'16.4'},
        {id:uid(), target:'21.1', sellQty:'76',  newStop:''},
      ]
    },
    {
      id:uid(), ticker:'SOUN', grade:'2',
      gradeNote:'ירידה של ~3% על ממרי מרקט, כניסה מסל VWAP',
      qty:'588', stop:'17',
      createdAt: new Date('2026-05-11').getTime() + 120000,
      targets:[
        {id:uid(), target:'10',    sellQty:'294', newStop:'9.35'},
        {id:uid(), target:'11.25', sellQty:'147', newStop:'9.9'},
        {id:uid(), target:'12.7',  sellQty:'147', newStop:''},
      ]
    },
    {
      id:uid(), ticker:'UGL', grade:'1',
      gradeNote:'ירידה $8 של 59.96, פיקוד buylimit',
      qty:'18', stop:'66',
      createdAt: new Date('2026-05-11').getTime() + 180000,
      targets:[
        {id:uid(), target:'64.3', sellQty:'9', newStop:'62.3'},
        {id:uid(), target:'68.8', sellQty:'4', newStop:'64.3'},
        {id:uid(), target:'74.5', sellQty:'5', newStop:''},
      ]
    },
    {
      id:uid(), ticker:'PLTR', grade:'1',
      gradeNote:'הממקום הלטפות, מקייקת נמוך מה יום קודם, כניסה מסל VWAP',
      qty:'51', stop:'198',
      createdAt: new Date('2026-05-20').getTime(),
      targets:[
        {id:uid(), target:'147', sellQty:'25', newStop:''},
        {id:uid(), target:'',    sellQty:'',   newStop:''},
        {id:uid(), target:'',    sellQty:'',   newStop:''},
      ]
    },
    {
      id:uid(), ticker:'BRUN', grade:'2',
      gradeNote:'',
      qty:'90', stop:'110',
      createdAt: new Date('2026-05-20').getTime() + 60000,
      targets:[
        {id:uid(), target:'31.5', sellQty:'45', newStop:'25'},
        {id:uid(), target:'',     sellQty:'45', newStop:''},
      ]
    },
    {
      id:uid(), ticker:'NVDL', grade:'1',
      gradeNote:'אמורפס אינברסיפיד. יוחר מאזדי $8 - VWAP, נחפה ביניים מסל, ניחוך 0.618 סטופ. סטופ מחיר: 101.35',
      qty:'30', stop:'',
      createdAt: new Date('2026-05-27').getTime(),
      targets:[
        {id:uid(), target:'130', sellQty:'15', newStop:''},
        {id:uid(), target:'',    sellQty:'',   newStop:''},
      ]
    },
    {
      id:uid(), ticker:'UGL', grade:'1',
      gradeNote:'כמות 150 (כניסה ~53.95)',
      qty:'150', stop:'62',
      createdAt: new Date('2026-05-27').getTime() + 60000,
      targets:[
        {id:uid(), target:'63', sellQty:'25', newStop:''},
        {id:uid(), target:'67', sellQty:'13', newStop:''},
        {id:uid(), target:'',   sellQty:'',   newStop:''},
      ]
    },
    {
      id:uid(), ticker:'BITX', grade:'2',
      gradeNote:'אמורפס ביטקוין. כניסה מסל VWAP. סטופ: 17.6 (פרם 0.68)',
      qty:'', stop:'68',
      createdAt: new Date('2026-05-27').getTime() + 120000,
      targets:[
        {id:uid(), target:'20', sellQty:'', newStop:'18.8'},
        {id:uid(), target:'22', sellQty:'', newStop:'19.9'},
        {id:uid(), target:'25', sellQty:'', newStop:''},
      ]
    },
    {
      id:uid(), ticker:'ONDS', grade:'1',
      gradeNote:'תיקון לגיטר 12.7 (פסים מהמנוע של יום קודם) וכניסה מסל VWAP',
      qty:'160', stop:'28',
      createdAt: new Date('2026-06-01').getTime(),
      targets:[
        {id:uid(), target:'15.3', sellQty:'80', newStop:'12.9'},
        {id:uid(), target:'19.6', sellQty:'40', newStop:''},
      ]
    },
  ];

  const merged = [...imported, ...existing];
  localStorage.setItem('tj-prep', JSON.stringify(merged));
  if(typeof prepRender === 'function') prepRender();
  alert('יובאו ' + imported.length + ' תכנונים בהצלחה! רענן את הדף.');
})();
