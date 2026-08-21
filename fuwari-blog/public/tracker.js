// 云笺集 · 访问追踪（博客页面加载后自动上报）
(function(){try{
  fetch('/dev/admin/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:location.pathname})})
}catch(e){}})();
