/**
 * Copyright 2014 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

module Shumway {
  import assert = Shumway.Debug.assert;
  import flash = Shumway.AVM2.AS.flash;
  import Point = Shumway.AVM2.AS.flash.geom.Point;
  import FrameContainer = Shumway.GFX.FrameContainer;
  import Easel = Shumway.GFX.Easel;

  import FramePhase = Shumway.Timeline.FramePhase;
  import LoadStatus = flash.display.LoadStatus;

  import ByteArray = flash.utils.ByteArray;
  import Event = flash.events.Event;
  import DisplayObject = flash.display.DisplayObject;
  import DisplayObjectContainer = flash.display.DisplayObjectContainer;
  import MovieClip = flash.display.MovieClip;
  import VisitorFlags = flash.display.VisitorFlags;

  /**
   * Shumway Player
   *
   * This class brings everything together. Load the swf, runs the event loop and
   * synchronizes the frame tree with the display list.
   */
  export class Player {
    private _stage: flash.display.Stage;
    private _loader: flash.display.Loader;
    private _loaderInfo: flash.display.LoaderInfo;
    private _syncTimeout: number;
    private _frameTimeout: number;
    private _frameContainer: FrameContainer;

    private static _syncFrameRate = 60;
    private _server: Remoting.Server;

    constructor(frameContainer: FrameContainer) {
      this._frameContainer = frameContainer;
      this._server = new Remoting.Server(this._frameContainer);
    }

    public load(url: string) {
      assert (!this._loader, "Can't load twice.");
      var self = this;
      var stage = this._stage = new flash.display.Stage();
      var loader = this._loader = new flash.display.Loader();
      var loaderInfo = this._loaderInfo = loader.contentLoaderInfo;

      loaderInfo.addEventListener(flash.events.ProgressEvent.PROGRESS, function onProgress() {
        var root = loader.content;
        if (!root) {
          return;
        }
        loaderInfo.removeEventListener(flash.events.ProgressEvent.PROGRESS, onProgress);
        stage.frameRate = loaderInfo.frameRate;
        stage.stageWidth = loaderInfo.width;
        stage.stageHeight = loaderInfo.height;
        stage.addChildAtDepth(root, 0);
        self._enterLoops();
      });

      this._loader.load(new flash.net.URLRequest(url));
    }

    public dispatchMouseEvent(event: MouseEvent, point: Point) {
      if (event.type !== "click") {
        return;
      }
//      console.log(point.toString());
//      var o = this._stage.getObjectsUnderPoint(point);
//      console.info(o);
//      for (var i = 0; i < o.length; i++) {
//        o[i].rotation ++;
//      }
//
//      var o = this._stage.getObjectsUnderPoint(point);
//      if (o && o.length) {
//        var t = o[o.length - 1];
//        (function (v) {
//          setInterval(function () {
//            v.rotation += 6;
//          }, 16);
//        })(t);
//      }
    }

    public dispatchKeyboardEvent(event: KeyboardEvent) {

    }

    private _enterLoops(): void {
      this._enterSyncLoop();
      this._enterEventLoop();
    }

    private _pumpDisplayListUpdates(): void {
      var stage = this._stage;
      var byteArray = new ByteArray();
      var visitor = new Shumway.Remoting.Client.ClientVisitor();

      visitor.output = byteArray;

      stage.visit(function (displayObject) {
        visitor.writeReferences = false;
        visitor.clearDirtyBits = false;
        visitor.visitDisplayObject(displayObject);
        return VisitorFlags.Continue;
      }, VisitorFlags.None);

      stage.visit(function (displayObject) {
        visitor.writeReferences = true;
        visitor.clearDirtyBits = true;
        visitor.visitDisplayObject(displayObject);
        return VisitorFlags.Continue;
      }, flash.display.VisitorFlags.None);

      byteArray.writeInt(Shumway.Remoting.MessageTag.EOF);
      byteArray.position = 0;
      this._server.recieve(byteArray);
    }

    /**
     * Update the frame container with the latest changes from the display list.
     */
    private _enterSyncLoop(): void {
      var self = this;
      (function tick() {
        self._syncTimeout = setTimeout(tick, 1000 / Player._syncFrameRate);
        timeline && timeline.enter("pumpUpdates");
        self._pumpDisplayListUpdates()
        timeline && timeline.leave("pumpUpdates");
      })();
    }

    private _leaveSyncLoop(): void {
      assert (this._frameTimeout > -1);
      clearInterval(this._frameTimeout);
    }

    private _enterEventLoop(): void {
      var self = this;
      var stage = this._stage;
      var needsInit = true;
      (function tick() {
        self._frameTimeout = setTimeout(tick, 1000 / stage.frameRate);
        timeline && timeline.enter("eventLoop");

        MovieClip.initFrame();
        DisplayObjectContainer.constructFrame();
        MovieClip.executeFrame();

        if (needsInit) {
          self._loaderInfo.loadStatus = LoadStatus.Initialized;
          needsInit = false;
        } else {
          stage.render();
        }

        timeline && timeline.leave("eventLoop");
      })();
    }

    private _leaveEventLoop(): void {
      assert (this._frameTimeout > -1);
      clearInterval(this._frameTimeout);
    }
  }

  export class EaselEmbedding {
    private static _mouseEvents = [
      'click',
      'dblclick',
      'mousedown',
      'mousemove',
      'mouseup',
      'mouseover',
      'mouseout'
    ];

    private static _keyboardEvents = [
      'keydown',
      'keypress',
      'keyup'
    ];

    private _mouseEventListener(event: MouseEvent) {
      var position = this._easel.getMouseWorldPosition(event);
      var point = new Point(position.x, position.y);
      this._player.dispatchMouseEvent(event, point);
    }

    private _keyboardEventListener(event: KeyboardEvent) {
      this._player.dispatchKeyboardEvent(event);
    }

    private _addEventListeners() {
      var mouseEventListener = this._mouseEventListener.bind(this);
      var keyboardEventListener = this._keyboardEventListener.bind(this);
      var mouseEvents = EaselEmbedding._mouseEvents;
      for (var i = 0; i < mouseEvents.length; i++) {
        window.addEventListener(mouseEvents[i], mouseEventListener);
      }
      var keyboardEvents = EaselEmbedding._keyboardEvents;
      for (var i = 0; i < keyboardEvents.length; i++) {
        window.addEventListener(keyboardEvents[i], keyboardEventListener);
      }
    }

    private _easel: Easel;
    private _player: Player;

    constructor(easel: Easel, player: Player) {
      this._easel = easel;
      this._player = player;
      this._addEventListeners();
    }

    public embed(): Player {
      return this._player = new Shumway.Player(this._easel.world);
    }
  }
}