/*
 * Copyright (C) 2015 SUSE Linux
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the LICENSE.txt file for details.
 */

(function () {
  'use strict';

  angular.module('janusHangouts')
    .directive('jhSigninForm', jhSigninFormDirective);

  jhSigninFormDirective.$inject = ['$state', 'UserService', 'RoomService'];

  function jhSigninFormDirective($state, UserService, RoomService) {
    return {
      restrict: 'EA',
      templateUrl: 'app/components/user/jh-signin-form.html',
      scope: true,
      link: jhSigninFormLink,
      controllerAs: 'vm',
      bindToController: true,
      controller: JhSigninFormCtrl
    };

    function jhSigninFormLink(scope, element) {
      setTimeout(function() {
        $('#inputUsername', element).focus();
      }, 100);
    }

    function JhSigninFormCtrl() {

      function getParameterByName(name) {
        name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
        var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
          results = regex.exec(window.location.search);
        return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
      }

      // get room and signin from command parameters

      /* jshint: validthis */
      var vm = this;
      vm.username = getParameterByName('username');
      vm.room = getParameterByName('room');
      vm.rooms = [];
      vm.signin = signin;

      var roomNumber = getParameterByName('number');

      RoomService.connect().then(function() {
        RoomService.getAvailableRooms(vm.room, roomNumber).then(function(rooms) {
          vm.rooms = rooms;
        });
      });

      function signin(username, room) {
        if (room) {
          RoomService.setRoom(room);
          UserService.signin(username).then(function (user) {
            if (user) {
              $state.go('home');
            }
          });
        }
      }
    }
  }
})();
