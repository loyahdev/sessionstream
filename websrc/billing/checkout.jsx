import React,{useEffect,useRef,useState,useCallback,Component} from 'react';
import {createRoot} from 'react-dom/client';
import {ClerkProvider,ClerkLoaded,SignedIn,SignedOut} from '@clerk/clerk-react';
import {CheckoutProvider,useCheckout,PaymentElementProvider,PaymentElement,usePaymentElement} from '@clerk/clerk-react/experimental';
import {verifyCheckoutPrice,completeCheckout,paymentMessage} from './checkout-flow.js';

class CheckoutBoundary extends Component{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<div role="alert" className="payment-error">Payment could not be loaded. <a href="/dashboard/account/billing">Open billing</a> or <a href="mailto:support@sessionstream.app">contact support</a>.</div>:this.props.children}
}
function Preparing({error,onRetry}){return <div className="payment-preparing" role={error?'alert':'status'}>{error?<><p>{error}</p><button className="checkout-submit" type="button" onClick={onRetry}>Try loading payment again</button></>:<><span className="payment-spinner" aria-hidden="true"/><p>Preparing secure payment…</p></>}</div>}
function CheckoutFlow({planId,verify,stripeAppearance}){
 const {checkout}=useCheckout(),started=useRef(false);const [error,setError]=useState('');
 const start=useCallback(async()=>{setError('');try{const result=await checkout.start();if(result.error)setError(paymentMessage(result.error))}catch(e){setError(paymentMessage(e))}},[checkout.start]);
 useEffect(()=>{if(checkout.status==='needs_initialization'&&!started.current){started.current=true;void start()}},[checkout.status,start]);
 if(checkout.status==='needs_initialization')return <Preparing error={error} onRetry={start}/>;
 if(checkout.status==='completed')return <div className="payment-complete" role="status"><h3>Your payment is confirmed.</h3><p>Your dashboard will show your verified Pro subscription.</p><a className="checkout-submit" href="/dashboard/welcome/">Continue to your dashboard</a></div>;
 try{verifyCheckoutPrice(checkout,planId)}catch(e){return <p className="payment-error" role="alert">{e.message}</p>}
 return <PaymentElementProvider checkout={checkout} stripeAppearance={stripeAppearance}><PaymentForm verify={verify}/></PaymentElementProvider>;
}
function PaymentForm({verify}){
 const {checkout}=useCheckout(),{isFormReady,submit}=usePaymentElement();
 const [accepted,setAccepted]=useState(false),[processing,setProcessing]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false),locked=useRef(false);
 async function purchase(event){event.preventDefault();if(!isFormReady||!accepted||locked.current||uncertain)return;locked.current=true;setProcessing(true);setError('');try{await completeCheckout({verify,submit,confirm:checkout.confirm,finalize:()=>checkout.finalize({navigate:()=>location.assign('/dashboard/welcome/')})})}catch(e){setError(paymentMessage(e));setUncertain(!!e.uncertain)}finally{locked.current=false;setProcessing(false)}}
 return <form onSubmit={purchase}><div className="payment-fields"><PaymentElement fallback={<Preparing/>}/></div><div className="checkout-total"><span>Due today</span><strong>$5.00 <small>USD</small></strong></div><p className="checkout-renewal">Then $5 USD per month. Renews monthly until canceled.</p>{error&&<div className="payment-error" role="alert"><p>{error}</p>{uncertain&&<a href="/dashboard/account/billing">Check your billing</a>}</div>}<div className="purchase-consent"><input id="purchase-consent" name="purchase-consent" type="checkbox" required checked={accepted} disabled={processing||uncertain} onChange={event=>setAccepted(event.target.checked)}/><label htmlFor="purchase-consent">I agree to the <a href="/terms/" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy/" target="_blank" rel="noopener">Privacy Policy</a>.</label></div><button type="submit" className="checkout-submit" disabled={!isFormReady||!accepted||processing||uncertain}>{processing?'Confirming payment…':'Subscribe to Pro · $5/month'}<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></button><p className="checkout-terms">Cancel future renewals in Billing.</p></form>;
}
export function mountCheckout(container,{clerk,planId,appearance,verify,stripeAppearance}){
 createRoot(container).render(<CheckoutBoundary><ClerkProvider Clerk={clerk} publishableKey={'pk_live_'+btoa('clerk.sessionstream.app$')} appearance={appearance}><ClerkLoaded><SignedIn><CheckoutProvider for="user" planId={planId} planPeriod="month"><CheckoutFlow planId={planId} verify={verify} stripeAppearance={stripeAppearance}/></CheckoutProvider></SignedIn><SignedOut><p>Please <a href="/api/account/sign-in?intent=upgrade">sign in</a> to continue.</p></SignedOut></ClerkLoaded></ClerkProvider></CheckoutBoundary>);
}
