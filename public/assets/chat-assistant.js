(function(){
  'use strict';

  if(window.__codexChatAssistantLoaded) return;
  window.__codexChatAssistantLoaded=true;

  const state={
    open:false,
    sending:false,
    messages:[]
  };

  const escapeHtml=value=>String(value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');

  const pageLinks={
    '/index.html':{label:'Home',title:'Go to Home'},
    '/about.html':{label:'About Codex Inc',title:'Learn about Codex Inc'},
    '/works.html':{label:'View Projects',title:'Explore Codex Inc projects'},
    '/services.html':{label:'Our Services',title:'Explore services'},
    '/experience.html':{label:'Experience',title:'View experience'},
    '/team-up.html':{label:'Team Up',title:'Collaborate with Codex Inc'},
    '/updates.html':{label:'Explore Updates',title:'View latest updates'},
    '/contact.html':{label:'Contact Codex Inc',title:'Get in touch'}
  };

  function renderMarkdown(value){
    let text=escapeHtml(value);

    text=text.replace(
      /\[([^\]]+)\]\((\/[^\s)]+|https?:\/\/[^\s)]+)\)/g,
      function(_,label,url){
        const internal=pageLinks[url];
        if(internal){
          return '<button type="button" class="codex-chat-nav" data-chat-url="'+url+'">'+
            escapeHtml(internal.label)+
          '</button>';
        }

        return '<a class="codex-chat-external" href="'+url+
          '" target="_blank" rel="noopener noreferrer">'+
          label+
          '</a>';
      }
    );

    text=text.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    text=text.replace(/__([^_]+)__/g,'<strong>$1</strong>');
    text=text.replace(/\*([^*\n]+)\*/g,'<em>$1</em>');
    text=text.replace(/`([^`]+)`/g,'<code>$1</code>');

    const lines=text.split('\n');
    const output=[];
    let inList=false;

    for(const line of lines){
      const match=line.match(/^\s*[-*]\s+(.+)$/);

      if(match){
        if(!inList){
          output.push('<ul>');
          inList=true;
        }
        output.push('<li>'+match[1]+'</li>');
      }else{
        if(inList){
          output.push('</ul>');
          inList=false;
        }

        if(line.trim()){
          output.push('<p>'+line+'</p>');
        }
      }
    }

    if(inList) output.push('</ul>');

    return output.join('');
  }

  function createAssistant(){
    if(document.getElementById('codex-chat')) return;

    const root=document.createElement('div');
    root.id='codex-chat';

    root.innerHTML=`
      <button
        class="codex-chat-launcher"
        type="button"
        aria-label="Open Codex Inc Assistant"
        aria-expanded="false"
        aria-controls="codex-chat-panel"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4 2v-4.2A7.45 7.45 0 0 1 2.5 11.5 7.5 7.5 0 0 1 10 4h2.5A7.5 7.5 0 0 1 20 11.5Z"/>
          <path d="M8 11h8M8 14h5"/>
        </svg>
        <span>Chat with Codex</span>
      </button>

      <section
        id="codex-chat-panel"
        class="codex-chat-panel"
        aria-label="Codex Inc Assistant"
        aria-hidden="true"
        hidden
      >
        <header class="codex-chat-header">
          <div class="codex-chat-brand">
            <div class="codex-chat-avatar" aria-hidden="true">C</div>
            <div>
              <strong>Codex Inc Assistant</strong>
              <span><i></i> Available to help</span>
            </div>
          </div>

          <button
            class="codex-chat-close"
            type="button"
            aria-label="Close assistant"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18"/>
            </svg>
          </button>
        </header>

        <div class="codex-chat-messages" aria-live="polite"></div>

        <form class="codex-chat-form">
          <textarea
            class="codex-chat-input"
            rows="1"
            maxlength="1000"
            placeholder="Ask about Codex Inc..."
            aria-label="Message"
          ></textarea>

          <button
            class="codex-chat-send"
            type="submit"
            aria-label="Send message"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m4 4 16 8-16 8 3-8-3-8Z"/>
              <path d="M7 12h13"/>
            </svg>
          </button>
        </form>

        <div class="codex-chat-footer">
          <span>Codex Inc</span>
          <span>AI Assistant</span>
        </div>
      </section>
    `;

    document.body.appendChild(root);

    const launcher=root.querySelector('.codex-chat-launcher');
    const panel=root.querySelector('.codex-chat-panel');
    const close=root.querySelector('.codex-chat-close');
    const form=root.querySelector('.codex-chat-form');
    const input=root.querySelector('.codex-chat-input');

    function openChat(){
      state.open=true;
      panel.hidden=false;
      panel.setAttribute('aria-hidden','false');
      launcher.setAttribute('aria-expanded','true');
      launcher.classList.add('is-open');
      window.setTimeout(()=>input.focus(),50);
    }

    function closeChat(){
      state.open=false;
      panel.hidden=true;
      panel.setAttribute('aria-hidden','true');
      launcher.setAttribute('aria-expanded','false');
      launcher.classList.remove('is-open');
      launcher.focus();
    }

    launcher.addEventListener('click',function(event){
      event.preventDefault();
      event.stopPropagation();

      if(state.open){
        closeChat();
      }else{
        openChat();
      }
    });

    close.addEventListener('click',function(event){
      event.preventDefault();
      event.stopPropagation();
      closeChat();
    });

    panel.addEventListener('click',function(event){
      const navigation=event.target.closest('[data-chat-url]');
      if(!navigation) return;

      event.preventDefault();

      const url=navigation.getAttribute('data-chat-url');
      if(url) window.location.href=url;
    });

    document.addEventListener('keydown',function(event){
      if(event.key==='Escape' && state.open){
        closeChat();
      }
    });

    form.addEventListener('submit',function(event){
      event.preventDefault();
      sendMessage();
    });

    input.addEventListener('keydown',function(event){
      if(event.key==='Enter'&&!event.shiftKey){
        event.preventDefault();
        form.requestSubmit();
      }
    });

    input.addEventListener('input',function(){
      input.style.height='auto';
      input.style.height=Math.min(input.scrollHeight,120)+'px';
    });

    addMessage(
      'assistant',
      'Hi. I’m the Codex Inc assistant. Ask me about our projects, services, experience, Team Up, updates, or how to contact us.'
    );
  }

  function render(){
    const container=document.querySelector('.codex-chat-messages');
    if(!container) return;

    container.innerHTML=state.messages.map(function(message){
      return `
        <div class="codex-chat-message codex-chat-message-${message.role}">
          <div class="codex-chat-bubble">${
            message.role==='assistant'
              ? renderMarkdown(message.text)
              : escapeHtml(message.text).replace(/\n/g,'<br>')
          }</div>
        </div>
      `;
    }).join('');

    container.scrollTop=container.scrollHeight;
  }

  function addMessage(role,text){
    state.messages.push({role,text});
    render();
  }

  function setTyping(show){
    const container=document.querySelector('.codex-chat-messages');
    if(!container) return;

    const existing=document.getElementById('codex-chat-typing');

    if(show&&!existing){
      const typing=document.createElement('div');
      typing.id='codex-chat-typing';
      typing.className='codex-chat-message codex-chat-message-assistant';

      typing.innerHTML=`
        <div class="codex-chat-bubble codex-chat-typing">
          <span></span><span></span><span></span>
        </div>
      `;

      container.appendChild(typing);
      container.scrollTop=container.scrollHeight;
    }else if(!show&&existing){
      existing.remove();
    }
  }

  async function sendMessage(){
    const input=document.querySelector('.codex-chat-input');
    if(!input||state.sending) return;

    const message=input.value.trim();
    if(!message) return;

    state.sending=true;
    input.value='';
    input.style.height='auto';

    addMessage('user',message);
    setTyping(true);

    try{
      const response=await fetch('/api/chat',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({message})
      });

      const data=await response.json().catch(()=>({}));

      if(!response.ok){
        throw new Error(data.error||'Unable to get a response');
      }

      setTyping(false);
      addMessage(
        'assistant',
        String(data.reply||'I’m unable to answer that right now.')
      );
    }catch(error){
      setTyping(false);
      addMessage(
        'assistant',
        'Sorry, I couldn’t process that right now. Please try again in a moment.'
      );
      console.error('Codex chat error:',error);
    }finally{
      state.sending=false;
      input.focus();
    }
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',createAssistant);
  }else{
    createAssistant();
  }
})();
