import { EventEmitter } from 'events';
import { RenderEngine } from './render-engine';
import { OffscreenRenderEngine } from './offscreen-render-engine';
import { HitRegion, Mouse } from '../types';
import { SeparatedInteractionsEngine } from './separated-interactions-engine';

export class InteractionsEngine extends EventEmitter {
    private renderEngine: RenderEngine;
    private readonly canvas: HTMLCanvasElement;
    private hitRegions: HitRegion[];
    private instances: SeparatedInteractionsEngine[];
    mouse: Mouse;
    selectedRegion: HitRegion | null;
    private hoveredRegion: HitRegion | null;
    private moveActive: boolean;
    private isRightClick: boolean;
    private mouseDownPosition: Mouse;
    private mouseDownHoveredInstance: SeparatedInteractionsEngine | undefined;
    private hoveredInstance: SeparatedInteractionsEngine | undefined;
    private currentCursor: string | null;

    constructor(canvas: HTMLCanvasElement, renderEngine: RenderEngine) {
        super();

        this.renderEngine = renderEngine;
        this.canvas = canvas;

        this.hitRegions = [];
        this.instances = [];
        this.mouse = {
            x: 0,
            y: 0,
            isInsideFg: false,
        };
        this.isRightClick = false;
        this.handleMouseWheel = this.handleMouseWheel.bind(this);
        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.handleMouseUp = this.handleMouseUp.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseOut = this.handleMouseOut.bind(this);
        this.handleMouseDBCLick = this.handleMouseDBCLick.bind(this);

        this.initListeners();

        this.reset();
    }

    makeInstance(renderEngine: OffscreenRenderEngine) {
        const separatedInteractionsEngine = new SeparatedInteractionsEngine(this, renderEngine);

        this.instances.push(separatedInteractionsEngine);

        return separatedInteractionsEngine;
    }

    reset() {
        this.selectedRegion = null;
        this.hoveredRegion = null;
        this.hitRegions = [];
    }

    destroy() {
        this.removeListeners();
    }

    initListeners() {
        if (this.canvas) {
            this.canvas.addEventListener('wheel', this.handleMouseWheel);
            this.canvas.addEventListener('mousedown', this.handleMouseDown);
            this.canvas.addEventListener('mouseup', this.handleMouseUp);
            //this.canvas.addEventListener('mouseleave', this.handleMouseUp);
            this.canvas.addEventListener('mousemove', this.handleMouseMove);
            this.canvas.addEventListener('mouseout', this.handleMouseOut);
            this.canvas.addEventListener('dblclick', this.handleMouseDBCLick);
        }
    }

    removeListeners() {
        if (this.canvas) {
            this.canvas.removeEventListener('wheel', this.handleMouseWheel);
            this.canvas.removeEventListener('mousedown', this.handleMouseDown);
            this.canvas.removeEventListener('mouseup', this.handleMouseUp);
            //this.canvas.removeEventListener('mouseleave', this.handleMouseUp);
            this.canvas.removeEventListener('mousemove', this.handleMouseMove);
            this.canvas.removeEventListener('mouseout', this.handleMouseOut);
            this.canvas.removeEventListener('dblclick', this.handleMouseDBCLick);
        }
    }

    handleMouseOut() {
        // Let consumers detect when mouse cursor has exited
        this.mouse.isInsideFg = false;
        this.emit('mouseout', this.mouse);
    }

    handleMouseWheel(e) {
        if (e.metaKey == true) {
            const { deltaY, deltaX } = e;
            e.preventDefault();

            const realView = this.renderEngine.getRealView();
            const initialZoom = this.renderEngine.getInitialZoom();
            const startPosition = this.renderEngine.positionX;
            const startZoom = this.renderEngine.zoom;
            const positionScrollDelta = deltaX / this.renderEngine.zoom;
            let zoomDelta = (deltaY / 1000) * this.renderEngine.zoom;

            this.renderEngine.tryToChangePosition(positionScrollDelta);

            zoomDelta =
                this.renderEngine.zoom - zoomDelta >= initialZoom ? zoomDelta : this.renderEngine.zoom - initialZoom;

            if (zoomDelta !== 0) {
                const zoomed = this.renderEngine.setZoom(this.renderEngine.zoom - zoomDelta);

                if (zoomed) {
                    const proportion = this.mouse.x / this.renderEngine.width;
                    const timeDelta = realView - this.renderEngine.width / this.renderEngine.zoom;
                    const positionDelta = timeDelta * proportion;

                    this.renderEngine.tryToChangePosition(positionDelta);
                }
            }

            this.checkRegionHover();

            if (startPosition !== this.renderEngine.positionX || startZoom !== this.renderEngine.zoom) {
                this.renderEngine.render();
            }
        } else {
            const { deltaY } = e;
            e.preventDefault();
            const mouseDeltaY = this.mouse.y - deltaY;
            this.mouseDownHoveredInstance = this.hoveredInstance;
            if (mouseDeltaY) {
                this.emit(
                    'change-position',
                    {
                        deltaX: 0,
                        deltaY: deltaY,
                    },
                    { x: this.mouse.x, y: mouseDeltaY },
                    this.mouse,
                    this.mouseDownHoveredInstance
                );
            }

            this.checkRegionHover();

            this.emit('move', this.hoveredRegion, this.mouse);
            this.clearCursor();
        }
    }

    handleMouseDown(e) {
        const event = e || window.event;
        let btnCode;
        this.isRightClick = false;
        if ('object' === typeof e) {
            btnCode = event.button;

            switch (btnCode) {
                case 0:
                    //console.log('Left');
                    this.moveActive = true;
                    this.mouseDownPosition = {
                        x: this.mouse.x,
                        y: this.mouse.y,
                    };
                    this.mouseDownHoveredInstance = this.hoveredInstance;
                    //this.emit('down', this.hoveredRegion, this.mouse);
                    break;

                case 1:
                    //console.log('Middle');
                    break;

                case 2:
                    this.isRightClick = true;
                    this.mouseDownPosition = {
                        x: this.mouse.x,
                        y: this.mouse.y,
                    };
                    this.mouseDownHoveredInstance = this.hoveredInstance;
                    this.emit('mouseright', this.hoveredRegion, this.mouse);
                    break;
            }
        }
    }

    handleMouseUp() {
        this.moveActive = false;
        if (!this.isRightClick) {
            const isClick =
                this.mouseDownPosition &&
                this.mouseDownPosition.x === this.mouse.x &&
                this.mouseDownPosition.y === this.mouse.y;
            if (isClick) {
                this.emit('click', this.hoveredRegion, this.mouse);
            }

            this.emit('up', this.hoveredRegion, this.mouse, isClick);
        }
    }

    handleMouseMove(e) {
        this.mouse.isInsideFg = true;
        if (this.moveActive) {
            const mouseDeltaY = this.mouse.y - e.offsetY;
            const mouseDeltaX = (this.mouse.x - e.offsetX) / this.renderEngine.zoom;

            if (mouseDeltaY || mouseDeltaX) {
                this.emit(
                    'change-position',
                    {
                        deltaX: mouseDeltaX,
                        deltaY: mouseDeltaY,
                    },
                    this.mouseDownPosition,
                    this.mouse,
                    this.mouseDownHoveredInstance
                );
            }
        }

        this.mouse.x = e.offsetX;
        this.mouse.y = e.offsetY;

        this.checkRegionHover();

        this.emit('move', this.hoveredRegion, this.mouse);
    }

    // handleRegionHit() {
    //     const selectedRegion = this.getHoveredRegion();

    //     this.emit('select', selectedRegion, this.mouse);
    // }

    handleMouseDBCLick() {
        const isClick =
            this.mouseDownPosition &&
            this.mouseDownPosition.x === this.mouse.x &&
            this.mouseDownPosition.y === this.mouse.y;
        if (isClick) {
            this.emit('double', this.hoveredRegion, this.mouse, isClick);
        }
        this.moveActive = false;
    }

    checkRegionHover() {
        const hoveredRegion = this.getHoveredRegion();

        if (hoveredRegion) {
            if (!this.currentCursor && hoveredRegion.cursor) {
                this.renderEngine.canvas.style.cursor = hoveredRegion.cursor;
            } else if (!this.currentCursor) {
                this.clearCursor();
            }

            this.hoveredRegion = hoveredRegion;
            this.emit('hover', hoveredRegion, this.mouse);
            this.renderEngine.partialRender();
        } else if (this.hoveredRegion && !hoveredRegion) {
            if (!this.currentCursor) {
                this.clearCursor();
            }

            this.hoveredRegion = null;
            this.emit('hover', null, this.mouse);
            this.renderEngine.partialRender();
        }
    }

    getHoveredRegion() {
        const hoveredRegion = this.hitRegions.find(
            ({ x, y, w, h }) => this.mouse.x >= x && this.mouse.x <= x + w && this.mouse.y >= y && this.mouse.y <= y + h
        );

        if (hoveredRegion) {
            return hoveredRegion;
        }
        const hoveredInstance = this.instances.find(
            ({ renderEngine }) =>
                renderEngine.position <= this.mouse.y && renderEngine.height + renderEngine.position >= this.mouse.y
        );

        this.hoveredInstance = hoveredInstance;

        if (hoveredInstance) {
            const offsetTop = hoveredInstance.renderEngine.position;

            return hoveredInstance.hitRegions.find(
                ({ x, y, w, h }) =>
                    this.mouse.x >= x &&
                    this.mouse.x <= x + w &&
                    this.mouse.y >= y + offsetTop &&
                    this.mouse.y <= y + h + offsetTop
            );
        }
        return null;
    }

    clearHitRegions() {
        this.hitRegions = [];
    }

    addHitRegion(type, data, x: number, y: number, w: number, h: number, cursor: string) {
        this.hitRegions.push({
            type,
            data,
            x,
            y,
            w,
            h,
            cursor,
        });
    }

    setCursor(cursor: string) {
        this.renderEngine.canvas.style.cursor = cursor;
        this.currentCursor = cursor;
    }

    clearCursor() {
        const hoveredRegion = this.getHoveredRegion();
        this.currentCursor = null;

        if (hoveredRegion?.cursor) {
            this.renderEngine.canvas.style.cursor = hoveredRegion.cursor;
        } else {
            this.renderEngine.canvas.style.cursor = '';
        }
    }
}
