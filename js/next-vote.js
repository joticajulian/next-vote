var bots = [];
var bot_names = [];
var posts = [];
var ref_vote = 0.10;
var orderType = 1;

var totalPosts = 0;
var loadedPosts = 0;
var lastTime = new Date();

$(function () {
    var RETURN = 1;
    var AUTHOR_REWARDS = 0.75;
    var MIN_VOTE = 0;
    var CURRENCY = 'USD';
    
    var lastGetContentResponse = 0;
    $('#your_upvote').text('$'+ref_vote.toFixed(2));
    
    $.get('https://steembottracker.com/bidbots.json', function (data) {
      bots = data;

      bots.sort(function(a, b){
        if(a.name < b.name) return -1;
        if(a.name > b.name) return 1;
        return 0;
      });

      bots.forEach(function (bot) {
        bot_names.push(bot.name);        
      });
      console.log(bot_names);
      loadBotInfo();
    });
    
    function loadPrices() {
      // Load the current prices of STEEM and SBD
      /*$.get('https://api.coinmarketcap.com/v1/ticker/steem/', function (data) {
        steem_price = parseFloat(data[0].price_usd);
      });
      
      $.get('https://api.coinmarketcap.com/v1/ticker/steem-dollars/', function (data) {
        sbd_price = parseFloat(data[0].price_usd);
      });*/
      steem.api.getCurrentMedianHistoryPrice(function(err, response){
        steem_price = parseFloat(response.base.replace(" SBD",""))/parseFloat(response.quote.replace(" STEEM",""));
        console.log("steem_price: "+steem_price);
        
        var marketOrders = 10;
        steem.api.getOrderBook(marketOrders, function(err, response){
          var lowest_ask = parseFloat(response.asks[0].real_price);
          var highest_bid = parseFloat(response.bids[0].real_price);
          for(var i=1;i<marketOrders;i++){
            ask = parseFloat(response.asks[i].real_price);
            bid = parseFloat(response.bids[i].real_price);
            if(ask < lowest_ask) lowest_ask = ask;
            if(bid > highest_bid) highest_bid = bid;
          }
          pe = (lowest_ask + highest_bid)/2;
          sbd_price = steem_price/pe;
          console.log("sbd_price: "+sbd_price);
        });
      });  
    }
    loadPrices();
    setInterval(loadPrices, 30000);

    var first_load = true;
    function loadBotInfo() {
        console.log("loadBotInfo");
        loadingBots = true;
        console.log(bots);
        steem.api.getAccounts(bot_names, function (err, result) {
            try {
                result.forEach(function (account) {
                    console.log("looking account "+account.name);
                    var vote = getVoteValue(100, account);
                    var last_vote_time = new Date((account.last_vote_time) + 'Z');

                    var bot = bots.filter(function (b) { return b.name == account.name; })[0];

                    if(account.json_metadata != null && account.json_metadata != '') {
                      var json_metadata = JSON.parse(account.json_metadata);

                      if(json_metadata && json_metadata.config) {
                        var config = json_metadata.config;

                        if(config.min_bid_sbd && parseFloat(config.min_bid_sbd) > 0)
                          bot.min_bid = parseFloat(config.min_bid_sbd);

                        if(config.min_bid_steem && parseFloat(config.min_bid_steem) > 0)
                          bot.min_bid_steem = parseFloat(config.min_bid_steem);

                        if(config.bid_window && parseFloat(config.bid_window) > 0)
                          bot.interval = parseFloat(config.bid_window);

                        if(config.pre_vote_group_url && config.pre_vote_group_url != '')
                          bot.pre_vote_group_url = config.pre_vote_group_url;

                        if (config.funding_url && config.funding_url != '')
                          bot.funding_url = config.funding_url;

                        if(config.accepts_steem != undefined)
                          bot.accepts_steem = config.accepts_steem;

                        if(config.refunds != undefined)
                          bot.refunds = config.refunds;

                        if(config.comments != undefined)
                          bot.comments = config.comments;

                        if (config.is_disabled != undefined)
                          bot.is_disabled = config.is_disabled;

                        if(config.api_url && config.api_url != '')
                          bot.api_url = config.api_url;

                        if (config.max_post_age && parseFloat(config.max_post_age) > 0)
                          bot.max_post_age = parseFloat(config.max_post_age);
                      }
                    }

                    // Don't list bots that have indicated that they are disabled.
                    if (bot.is_disabled)
                      return;

                    bot.last_vote_time = last_vote_time;
                    bot.vote = vote * bot.interval / 2.4;
                    bot.power = getVotingPower(account) / 100;
                    bot.last = (new Date() - last_vote_time);
                    bot.next = timeTilFullPower(account) * 1000;
                    bot.next_vote_time = new Date((new Date()).getTime() + bot.next);
                    bot.vote_usd = bot.vote / 2 * sbd_price + bot.vote / 2;

                    // Don't load bots that are filtered out
                    //if (bot.vote_usd < MIN_VOTE || (_filter.verified && !bot.api_url) || (_filter.refund && !bot.refunds) || (_filter.steem && !bot.accepts_steem) || (_filter.frontrunner && !bot.pre_vote_group_url) || (_filter.funding && !bot.funding_url))
                    //  return;

                    // Set the frequency of reload based on how close to the end of the round the bot is
                    var frequency = 300;
                    if (bot.next < 5 * 60 * 1000)
                      frequency = 10;
                    else if (bot.next < 20 * 60 * 1000)
                      frequency = 30;

                    // Check if the bot is ready to be refreshed based on the above defined frequency.
                    if (new Date() - bot.last_update < frequency * 1000)
                      return;

                    // Note when the bot was last updated.
                    bot.last_update = new Date();

                    if(bot.api_url) {
                      loadFromApi(bot);
                      return;
                    }

                    var transactions = 20;
                    if (first_load)
                      transactions = 2000;
                      
                    steem.api.getAccountHistory(account.name, -1, transactions, function (err, result) {
                        lastGetBot = new Date();
                        
                        if (err){                            
                            return;
                        }    

                        if (!bot.rounds)
                            bot.rounds = [];

                        var round = null;
                        if (bot.rounds.length == 0) {
                            round = { last_vote_time: 0, bids: [], total: 0, total_usd: 0 };
                            bot.rounds.push(round);
                        } else
                          round = bot.rounds[bot.rounds.length - 1];

                        result.forEach(function(trans) {
                            var op = trans[1].op;
                            var ts = new Date((trans[1].timestamp) + 'Z');

                            if (op[0] == 'transfer' && op[1].to == account.name && ts > round.last_vote_time) {
                                // Check that the memo is a valid post or comment URL.
                                if(!checkMemo(op[1].memo))
                                  return;

                                // Get the currency of the bid submitted
                                var currency = getCurrency(op[1].amount);

                                // Check that the bid is not in STEEM unless the bot accepts STEEM.
                                if(!bot.accepts_steem && currency == 'STEEM')
                                  return;

                                var existing = round.bids.filter(function (b) { return b.id == trans[0]; });

                                if (existing.length == 0) {
                                    var amount = parseFloat(op[1].amount);

                                    if (amount >= bot.min_bid) {
                                        round.bids.push({ id: trans[0], data: op[1] });
                                        round.total += amount;
                                        round.total_usd += getUsdValue(op[1]);
                                        
                                    }
                                }
                            } else if (op[0] == 'vote' && op[1].voter == account.name) {
                              round = bot.rounds.filter(function (r) { return r.last_vote_time >= (ts - 120 * 60 * 1000); })[0];

                              if (round == null) {
                                  round = { last_vote_time: ts, bids: [], total: 0, total_usd: 0 };
                                  bot.rounds.push(round);
                              }
                            }
                        });

                        bot.total = round.total;
                        bot.total_usd = round.total_usd;
                        bot.bid = (bot.vote - RETURN * bot.total) / RETURN;
                        console.log("Loaded bot: "+bot.name);  
                        totalPosts += bot.rounds[bot.rounds.length - 1].bids.length;                        
                        //loadPosts(bot);
                    });
                });
                first_load = false;
            } catch (err) {                
                console.log(err);
            }            
        });        
    }    

    function loadFromApi(bot) {
      $.get(bot.api_url, function (data) {
        bot.rounds = [];
        loadRoundFromApi(bot, data.last_round);
        var round = loadRoundFromApi(bot, data.current_round);
        bot.total = round.total;
        bot.total_usd = round.total_usd;
        bot.bid = (bot.vote - RETURN * bot.total) / RETURN;
        totalPosts += round.bids.length;
        console.log("Loaded bot (API): "+bot.name);
        //loadPosts(bot);                      
      });
    }

    function loadRoundFromApi(bot, data) {
      var round = { bids: [], total: 0 };

      if(data == null || data == undefined)
        data = [];

      // Sum the total of all the bids
      round.total = data.reduce(function(total, bid) { return total + bid.amount; }, 0);
      round.total_usd = data.reduce(function(total, bid) { return total + getUsdValue(bid); }, 0);

      // Map the bids to the bot tracker format
      round.bids = data.map(function(bid) {
        return {
          data: {
            amount: bid.amount + ' ' + bid.currency,
            from: bid.sender,
            memo: 'https://steemit.com' + bid.url,
            weight: bid.weight
          }
        }
      });

      bot.rounds.push(round);

      return round;
    }
    
    function loadPostsBots(){
      for(var i=0;i<bots.length;i++) loadPosts(bots[i]);
    }
    setInterval(loadPostsBots,3000);
    
    function loadPosts(bot){
      loadingPosts = true;
      lastGetContentResponse = 0;  
      if(typeof bot.rounds === 'undefined') return;      
      var round = bot.rounds[bot.rounds.length - 1];      
      console.log("Posts of "+bot.name+": "+round.bids.length);
      round.bids.forEach(function (bid){
        var memo = bid.data.memo;
        var amount = bid.data;
        var permLink = memo.substr(memo.lastIndexOf('/') + 1);
        var author = memo.substring(memo.lastIndexOf('@') + 1, memo.lastIndexOf('/'));
        var transfer_usd = getUsdValue(amount);
        var now = new Date();
                
        for(var i=0;i<posts.length;i++){
          if(posts[i].author == author && posts[i].permlink == permLink){
            if(typeof posts[i].votes === 'undefined') return;
            for(var j=0; j<posts[i].bot.length; j++) if(posts[i].bot[j] == bot.name) return;
            var now = new Date();
            var created = posts[i].created;
            
            var already_voted = posts[i].votes.length > 0 && (now - new Date(votes[0].time + 'Z') > 20 * 60 * 1000);
            var old_post = (now - created) >= (bot.max_post_age * 24 * 60 * 60 * 1000);
            if(!already_voted && !old_post){
              posts[i].transfer_usd += getUsdValue(amount);
              posts[i].bot.push(bot.name);
              posts[i].transfer.push(amount.amount);
              posts[i].next_vote_time.push(bot.next_vote_time);              
              posts[i].html = postHtml(posts[i]);
              reorder();              
            }
            totalPosts--;
            return;
          }
        }
        
        var post_aux = {author:author, permlink:permLink, loaded:0};
        posts.push(post_aux);
          
        steem.api.getContent(author, permLink, function (err, result) {
          if (!err && result && result.id > 0) {
            lastGetContentResponse = new Date();            
            
            var created = new Date(result.created + 'Z');
            var votes = result.active_votes.filter(function (vote) { return vote.voter == bot.name; });
            var pending_payout_value = parseFloat(result.pending_payout_value.replace(" SBD",""));                                   
            //var vote_value = bot.vote * transfer_usd / round.total_usd;
            var url = "https://steemit.com"+result.url;
            var post = {author:author, permlink:permLink, url:url, created:created, votes:votes, bot:[bot.name], current_payout:pending_payout_value, transfer:[amount.amount], transfer_usd:transfer_usd, next_vote_time:[bot.next_vote_time], json_metadata:JSON.parse(result.json_metadata),root_title:result.root_title,loaded:1};
            post.html = postHtml(post);
              
            var already_voted = votes.length > 0 && (now - new Date(votes[0].time + 'Z') > 20 * 60 * 1000);
            var old_post = (now - created) >= (bot.max_post_age * 24 * 60 * 60 * 1000); 
            var min30 = (now - created) >= (30 * 60 * 1000);
            
            if(!already_voted && !old_post && min30){
              for(i=0;i<posts.length;i++){
                if(posts[i].author == author && posts[i].permlink == permLink){
                  posts[i] = post;
                  reorder();
                  loadedPosts++;
                  break;
                }
              }
            }else{
              totalPosts--;
            }
            refreshProgress();            
          }else{
            console.log("There was an error loading this post, please check the URL:"+author+"/"+permLink);
          }            
        });
      });
    }
    
    $('#selOrder').change(function(){
      orderType = this.value;
      reorder();
      console.log("changed order to "+orderType);
    });
    
    setInterval(update_timestamp,10000);
    
});

function refreshProgress(){
  var percentage = 100*loadedPosts/totalPosts;
  tPer = percentage.toFixed(2);
  tBar = loadedPosts + "/" + totalPosts + " posts";
  $('#progress-bar').text(tBar).attr('aria-valuenow', tPer).css('width',tPer+'%');
}

function postHtml(post){
  tag = post.json_metadata.tags[0];
  if(typeof post.json_metadata.image === 'undefined'){
    if(typeof post.json_metadata.thumbnail === 'undefined') url_image = '';
    else url_image = post.json_metadata.thumbnail;
  }else url_image = post.json_metadata.image[0];
  var next_vote = textNextVote(post.next_vote_time);
      
  var text = ''+ 
   '<div class="post">'+
   '  <div class="row">'+
   '    <div class="user_name col-sm-6 col-xs-6">'+
   '      <span class="author">'+
   '        <strong>'+
   '          <a href="http://steemit.com/@'+post.author+'">'+post.author+'</a>'+
   '        </strong>'+
   '      </span>'+
   '      <span class="tag">'+
   '        in '+tag+
   '      </span>'+
   '    </div>'+       
   '  </div>'+
   '  <div class="row">'+
   '    <div class="col-sm-2 col-xs-12 post_image">'+
   '      <a href="'+post.url+'">'+
   '        <img class="img-responsive" src="'+url_image+'"/>'+
   '      </a>'+
   '    </div>'+
   '    <div class="col-sm-10 col-xs-12 post_content">'+
   '      <div class="row post_title">'+
   '        <strong>'+
   '          <a href="'+post.url+'">'+post.root_title+'</a>'+
   '        </strong>'+
   '      </div>';
   
   for(i=0;i<post.transfer.length;i++){
     text = text +
     '      <div class="row">';
     if(i==0) text = text+'<div class="col-sm-1 col-xs-4 current_payout">$'+parseFloat(post.current_payout).toFixed(2)+'</div>';
     else text = text+ '<div class="col-sm-1 col-xs-4 current_payout"></div>';
     text = text +
     '        <div class="col-sm-2 col-xs-4 transfer">'+post.transfer[i]+'</div>'+
     '        <div class="col-sm-4 col-xs-4 bot">'+
     '          <span class="timestamp">@'+post.bot[i]+'</span>'+
     '          <span class="timestamp_text timestamp" title="'+formatTime(post.next_vote_time[i])+'">'+
                  textNextVote(post.next_vote_time[i])+
     '          </span>'+
     '        </div>'+
     '      </div>';     
   }
   
   return text+
   '    </div>'+
   '  </div>'+
   '</div>';  
 }
    
function formatTime(t){
  return t.getFullYear()+'-'+addZero(t.getMonth()+1)+'-'+addZero(t.getDate())+'T'+addZero(t.getHours())+':'+addZero(t.getMinutes())+':'+addZero(t.getSeconds()) 
}

function addZero(x){
  if(x < 10) return "0"+x;
  else return ""+x;
}
    
function update_timestamp() {
  $(".timestamp_text").each(function() {
    var time = new Date($(this).attr('title'));
    $(this).text(textNextVote(time));        
  });  
}    
   
function checkMemo(memo) {
  return (memo.lastIndexOf('/') >= 0 && memo.lastIndexOf('@') >= 0);
}   

function textNextVote(t){
  var now = new Date();
  var minutes = Math.floor((t-now)/(60 * 1000));
  var seconds = Math.floor((t-now)/1000 - 60*minutes);
  if(minutes<0){ minutes=0; seconds=0; }
      
  text = ' votes in ';
  if(minutes == 0) text = text + seconds + ' seconds';
  else if(minutes == 1) text = text + '1 minute';
  else text = text + minutes + ' minutes';
  return text;      
}

function reorderVoteValue(){   
  var name = $('#account').val();
  var vote = parseFloat(name);
  if(Number.isNaN(vote)){ //it is an account
    name = name.substr(name.lastIndexOf('@') + 1);
    steem.api.getAccounts([name], function (err, result) {
      account = result[0];
      console.log("looking account "+account.name);
      ref_vote = getVoteValue(100, account);
      reorder();
      $('#your_upvote').text('$'+ref_vote.toFixed(2));
      console.log("ref_vote="+ref_vote);
    });      
  }else{ //it is a value    
    ref_vote = vote;
    reorder();
    $('#your_upvote').text('$'+ref_vote.toFixed(2));
    console.log("ref_vote="+ref_vote);
  }        
}

function reorder(){
  if(new Date() - lastTime > 3 * 1000){
    if(orderType == 1) reorderByCuration();
    else if(orderType == 2) reorderByBid();
    else if(orderType == 3) reorderByTime();
  
    $('#bot_list').text("");
    for(i=0;i<posts.length;i++) if(parseInt(posts[i].loaded)==1) $('#bot_list').append(posts[i].html);
    lastTime = new Date();
  }
}

function reorderByCuration(){
  posts.sort(function(a,b){
    w0a = Math.sqrt(a.current_payout);
    w1a = Math.sqrt(a.current_payout + ref_vote);
    wta = Math.sqrt(a.current_payout + ref_vote + a.transfer_usd/sbd_price);
    sa = wta*(w1a - w0a);
        
    w0b = Math.sqrt(b.current_payout);
    w1b = Math.sqrt(b.current_payout + ref_vote);
    wtb = Math.sqrt(b.current_payout + ref_vote + b.transfer_usd/sbd_price);
    sb = wtb*(w1b - w0b);
        
    if(sa>sb) return -1;
    if(sa<sb) return 1;
    return 0;
  }); 
  $('#form-order-by-curation').show();  
}

function reorderByBid(){
  posts.sort(function(a,b){
    if(a.transfer_usd > b.transfer_usd) return -1;
    if(a.transfer_usd < b.transfer_usd) return 1;
    return 0;
  });
  $('#form-order-by-curation').hide();
}

function reorderByTime(){
  posts.sort(function(a,b){
    if(a.next_vote_time < b.next_vote_time) return -1;
    if(a.next_vote_time > b.next_vote_time) return 1;
    return 0;
  });
  $('#form-order-by-curation').hide();
}
