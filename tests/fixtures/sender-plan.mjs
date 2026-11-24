export function senderPlanFixture(plan=()=>'pro',now=Date.now){
  const store={read:async()=>null,write:async()=>{},clear:async()=>{}};
  return {
    account:{
      identity:{sub:'test-host'},status:()=>({phase:'signed-in'}),
      accessCredential:()=>'test-only',close(){}
    },
    linkStore:store,
    linkOptions:{request:async url=>Response.json(url.pathname.endsWith('/exchange')?{token:'a'.repeat(64),user:'test-host'}:{name:''})},
    dashboardOptions:{
      enabled:true,autoTimer:false,now,storeFactory:()=>store,
      fetchImpl:async url=>Response.json(url.endsWith('/enroll')
        ?{deviceCredential:'b'.repeat(64)}:{plan:plan(),listeners:plan()==='pro'?8:3})
    }
  };
}
