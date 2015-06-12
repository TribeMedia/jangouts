/*
 * Copyright (C) 2015 SUSE Linux
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the LICENSE.txt file for details.
 */

(function () {
  'use strict';

  angular.module('janusHangouts')
    .service('RoomService',  RoomService);

    RoomService.$inject = ['$q', '$rootScope', '$timeout', 'FeedsService', 'Room',
      'DataChannelService', 'ActionService', 'jhConfig', 'ScreenShareService'];

  function RoomService($q, $rootScope, $timeout, FeedsService, Room, DataChannelService, ActionService, jhConfig, ScreenShareService) {
    this.connect = connect;
    this.enter = enter;
    this.leave = leave;
    this.getAvailableRooms = getAvailableRooms;
    this.setRoom = setRoom;
    this.getRoom = getRoom;
    this.publishScreen = publishScreen;
    this.unPublishFeed = unPublishFeed;
    this.ignoreFeed = ignoreFeed;
    this.stopIgnoringFeed = stopIgnoringFeed;
    this.subscribeToFeeds = subscribeToFeeds;
    this.subscribeToFeed = subscribeToFeed;
    this.toggleChannel = toggleChannel;
    this.room = null;
    this.janus = null;

    var wsProtocol = (window.location.protocol === "https:") ? "wss:" : "ws:";
    if (jhConfig.janusServer) {
      this.server = jhConfig.janusServer;
    } else {
      this.server = [
        wsProtocol + '//' + window.location.hostname + '/janus/',
        window.location.protocol + '//' + window.location.hostname + '/janus/'
      ];
    }
    if (jhConfig.janusServerSSL && (window.location.protocol === "https:")) {
      this.server = jhConfig.janusServerSSL;
    }

    function connect() {
      var deferred = $q.defer();

      Janus.init({debug: false});
      this.janus = new Janus({
        server: this.server,
        success: function() {
          deferred.resolve();
        },
        error: function(error) {
          var msg = "Janus error: " + error;
          console.error(msg);
          alert(msg);
          deferred.reject();
        },
        destroyed: function() {
          console.log("Janus object destroyed");
        }
      });

      return deferred.promise;
    }

    // Enter the room
    function enter(username) {
      var that = this;
      var $$rootScope = $rootScope;
      var _handle = null;

      // Create new session
      this.janus.attach({
        plugin: "janus.plugin.videoroom",
        success: function(pluginHandle) {
          _handle = pluginHandle;
          console.log("Plugin attached! (" + pluginHandle.getPlugin() + ", id=" + pluginHandle.getId() + ")");
          // Step 1. Right after attaching to the plugin, we send a
          // request to join
          var register = { "request": "join", "room": that.room.id, "ptype": "publisher", "display": username };
          pluginHandle.send({"message": register});
          console.log("  -- This is a publisher/manager");
        },
        error: function(error) {
          console.error("Error attaching plugin... " + error);
        },
        consentDialog: function(on) {
          console.log("Consent dialog should be " + (on ? "on" : "off") + " now");
          $$rootScope.$broadcast('consentDialog.changed', on); /*XXX*/
        },
        ondataopen: function(data) {
          console.log("The publisher DataChannel is available");
          FeedsService.findMain().isDataOpen = true;
          DataChannelService.sendStatus(FeedsService.findMain());
        },
        onlocalstream: function(stream) {
          // Step 4b (parallel with 4a).
          // Send the created stream to the UI, so it can be attached to
          // some element of the local DOM
          console.log(" ::: Got a local stream :::");
          var feed = FeedsService.findMain();
          $timeout(function () {
            feed.stream = stream;
            observeAudio(feed);
          });
        },
        oncleanup: function () {
          console.log(" ::: Got a cleanup notification: we are unpublished now :::");
        },
        onmessage: function (msg, jsep) {
          var event = msg.videoroom;
          console.log("Event: " + event);

          // Step 2. Response from janus confirming we joined
          if (event === "joined") {
            console.log("Successfully joined room " + msg.room);
            ActionService.enterRoom(msg.id, username, _handle);
            // Step 3. Establish WebRTC connection with the Janus server
            // Step 4a (parallel with 4b). Publish our feed on server
            publishMainFeed(true);

            // Step 5. Attach to existing feeds, if any
            if ((msg.publishers instanceof Array) && msg.publishers.length > 0) {
              that.subscribeToFeeds(msg.publishers, that.room.id);
            }
            // The room has been destroyed
          } else if(event === "destroyed") {
            console.log("The room has been destroyed!");
            $$rootScope.$broadcast('room.destroy'); /*XXX*/
          } else if(event === "event") {
            // Any new feed to attach to?
            if ((msg.publishers instanceof Array) && msg.publishers.length > 0) {
              that.subscribeToFeeds(msg.publishers, that.room.id);
              // One of the publishers has gone away?
            } else if(msg.leaving !== undefined && msg.leaving !== null) {
              var leaving = msg.leaving;
              ActionService.destroyFeed(leaving);
              // One of the publishers has unpublished?
            } else if(msg.unpublished !== undefined && msg.unpublished !== null) {
              var unpublished = msg.unpublished;
              ActionService.destroyFeed(unpublished);
              // The server reported an error
            } else if(msg.error !== undefined && msg.error !== null) {
              console.log("Error message from server" + msg.error);
              $$rootScope.$broadcast('room.error', msg.error); /*XXX*/
            }
          }

          if (jsep !== undefined && jsep !== null) {
            console.log("Handling SDP as well...");
            console.log(jsep);
            _handle.handleRemoteJsep({jsep: jsep});
          }
        }
      });
    }

    function leave() {
      ActionService.leaveRoom();
    }

    function getAvailableRooms(name, number) {
      var deferred = $q.defer();

      number = (number && typeof(number) === 'string') ? parseInt(number) : number;

      // Create a new session just to get the list
      this.janus.attach({
        plugin: "janus.plugin.videoroom",
        success: function(pluginHandle) {
          console.log("getAvailableRooms plugin attached (" + pluginHandle.getPlugin() + ", id=" + pluginHandle.getId() + ")");
          var request = { "request": "list" };
          pluginHandle.send({"message": request, success: function(result) {
            // Free the resource (it looks safe to do it here)


            if (result.videoroom === "success") {
              var rooms = _.map(result.list, function(r) {
                return new Room(r);
              });

              if (!name || !number) {
                pluginHandle.detach();
                deferred.resolve(rooms);
              } else {
                // check for room exists...
                var i = 0;
                var found = false;
                for (i = 0; i < result.list.length && !found; ++i) {
                  var rid = result.list[i].room;
                  if (rid === number) {
                    found = true;
                  }
                }

                if (found) {
                  pluginHandle.detach();
                  deferred.resolve(rooms);
                } else {
                  // must create the room...
                  var newRoom = {"request": "create", "room": number, "ptype": "publisher", "description": name, "max_publishers" : 6, "bitrate": 128000 };
                  pluginHandle.send({"message" : newRoom, success: function(res) {
                    if (res.videoroom === "success") {
                      // query again...
                      pluginHandle.send({"message" : request, success: function(resList) {
                        if (resList.videoroom === "success") {
                          rooms = _.map(resList.list, function(r) {
                            return new Room(r);
                          });
                        }

                        pluginHandle.detach();
                        deferred.resolve(rooms);
                      }});
                    } else {
                      pluginHandle.detach();
                      deferred.resolve(rooms);
                    }
                  }});
                }
              }

            } else {
              deferred.reject();
            }
          }});
        }
      });
      return deferred.promise;
    }

    function setRoom(room) {
      this.room = room;
    }

    function getRoom() {
      return this.room;
    }

    // Negotiates WebRTC by creating a webRTC offer for sharing the audio and
    // (optionally) video with the janus server. On success (the stream is
    // created and accepted), publishes the corresponding feed on the janus
    // server.
    function publishMainFeed(useVideo) {
      console.log("publishMainFeed called: " + useVideo);
      var handle = FeedsService.findMain().pluginHandle;
      handle.createOffer({
        media: { // Publishers are sendonly
          videoRecv: false,
          videoSend: useVideo,
          audioRecv: false,
          audioSend: true,
          data: true
        },
        success: function(jsep) {
          console.log("Got publisher SDP!");
          console.log(jsep);
          var publish = { "request": "configure", "audio": true, "video": useVideo };
          handle.send({"message": publish, "jsep": jsep});
        },
        error: function(error) {
          console.error("WebRTC error:" + error);
          if (useVideo) {
            publishMainFeed(false);
          } else {
            console.error("WebRTC error... " + JSON.stringify(error));
            console.error(error);
          }
        }
      });
    }

    function subscribeToFeeds(list) {
      console.log("Got a list of available publishers/feeds:");
      console.log(list);
      for(var f in list) {
        var id = list[f].id;
        var display = list[f].display;
        console.log("  >> [" + id + "] " + display);
        var feed = FeedsService.find(id);
        if (feed === null || feed.waitingForHandle()) {
          this.subscribeToFeed(id, display);
        }
      }
    }

    function subscribeToFeed(id, display) {
      var that = this;
      var feed = FeedsService.find(id);
      var _handle = null;

      if (feed) {
        display = feed.display;
      }

      this.janus.attach({
        plugin: "janus.plugin.videoroom",
        success: function(pluginHandle) {
          _handle = pluginHandle;
          console.log("Plugin attached! (" + pluginHandle.getPlugin() + ", id=" + pluginHandle.getId() + ")");
          console.log("  -- This is a subscriber");
          // We wait for the plugin to send us an offer
          var listen = { "request": "join", "room": that.room.id, "ptype": "listener", "feed": id };
          pluginHandle.send({"message": listen});
        },
        error: function(error) {
          console.error("  -- Error attaching plugin... " + error);
        },
        onmessage: function(msg, jsep) {
          console.log(" ::: Got a message (listener) :::");
          console.log(JSON.stringify(msg));
          var event = msg.videoroom;
          console.log("Event: " + event);
          if(event === "attached") {
            // Subscriber created and attached
            $timeout(function() {
              if (feed) {
                ActionService.stopIgnoringFeed(id, _handle)
              } else {
                ActionService.remoteJoin(id, display, _handle);
              }
              console.log("Successfully attached to feed " + id + " (" + display + ") in room " + msg.room);
            });
          } else {
            // What has just happened?
          }

          if(jsep !== undefined && jsep !== null) {
            console.log("Handling SDP as well...");
            console.log(jsep);
            // Answer and attach
            _handle.createAnswer({
              jsep: jsep,
              media: { // We want recvonly audio/video
                audioSend: false,
                videoSend: false,
                data: true
              },
              success: function(jsep) {
                console.log("Got SDP!");
                console.log(jsep);
                var body = { "request": "start", "room": that.room.id };
                _handle.send({"message": body, "jsep": jsep});
              },
              error: function(error) {
                console.error("WebRTC error:" + error);
              }
            });
          }
        },
        onremotestream: function(stream) {
          $timeout(function() {
            var feed = FeedsService.find(id);
            feed.stream = stream;
          });
        },
        ondataopen: function(data) {
          console.log("The subscriber DataChannel is available");
          FeedsService.find(id).isDataOpen = true;
          // Send status information of all our feeds to inform the newcommer
          FeedsService.publisherFeeds().forEach(function (p) {
            DataChannelService.sendStatus(p);
          });
        },
        ondata: function(data) {
          console.log(" ::: Got info in the data channel (subscriber) :::");
          DataChannelService.receiveMessage(data, id);
        },
        oncleanup: function() {
          $timeout(function () {
            console.log(" ::: Got a cleanup notification (remote feed " + id + ") :::");
          });
        }
      });
    }

    function publishScreen() {
      var display = FeedsService.findMain().display;
      var that = this;
      var _handle;
      var _id;

      this.janus.attach({
        plugin: "janus.plugin.videoroom",
        success: function(pluginHandle) {
          console.log("Screen sharing plugin attached");
          var register = {
            "request": "join",
            "room": that.room.id,
            "ptype": "publisher",
            "display": display };
          pluginHandle.send({"message": register});
          ScreenShareService.setInProgress(true);
          _handle = pluginHandle;
        },
        error: function(error) {
          console.error("  -- Error attaching screen plugin... " + error);
        },
        onlocalstream: function(stream) {
          console.log(" ::: Got the screen stream :::");
          var feed = FeedsService.find(_id);
          $timeout(function () {
            feed.stream = stream;
          });
        },
        onmessage: function(msg, jsep) {
          console.log(" ::: Got a message (screen) :::");
          console.log(msg);
          var event = msg.videoroom;

          if (event === "joined") {
            _id = msg.id;
            ActionService.publishScreen(_id, display, _handle);
            publishScreenFeed(FeedsService.find(_id));
          } else {
            console.log("Unexpected event for screen");
          }
          if (jsep !== undefined && jsep !== null) {
            console.log("Handling SDP as well...");
            console.log(jsep);
            _handle.handleRemoteJsep({jsep: jsep});
          }
        }
      });
    }

    function unPublishFeed(feedId) {
      ActionService.destroyFeed(feedId);
    }

    function ignoreFeed(feedId) {
      ActionService.ignoreFeed(feedId);
    }

    function stopIgnoringFeed(feedId) {
      this.subscribeToFeed(feedId);
    }

    function publishScreenFeed(feed) {
      console.log("publishScreenFeed called");
      var handle = feed.pluginHandle;

      handle.createOffer({
        media: {
          videoRecv: false,
          audio: false,
          video: "screen",
          data: false
        },
        success: function(jsep) {
          console.log("Got publisher SDP!");
          console.log(jsep);
          var publish = { "request": "configure", "audio": false, "video": true };
          handle.send({"message": publish, "jsep": jsep});
          ScreenShareService.setInProgress(false);
        },
        error: function(error) {
          console.error(error);
          unPublishFeed(feed.id);
          ScreenShareService.setInProgress(false);
          ScreenShareService.showHelp();
        }
      });
    }

    function observeAudio(feed) {
      var speech = hark(feed.stream);
      speech.on('speaking', function() {
        $timeout(function() {
          feed.setSpeaking(true);
        });
      });
      speech.on('stopped_speaking', function() {
        feed.setSpeaking(false);
      });
    }

    function toggleChannel(type, feed) {
      ActionService.toggleChannel(type, feed);
    }
  }
}());
