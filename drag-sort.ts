interface DragSortOption {
  transition?: string;
  handleClass?: string;
  draggingClass?: string;
  shadowClass?: string;
  placeholderClass?: string;
  threshold?: number;
}

export class DragSort {
  private _startIndex = -1;
  private _endIndex = -1;
  private _placeholderEl: HTMLElement | null = null;
  private _shadowEl: HTMLElement | null = null;
  private _transitionEnded = true;
  private _dragEndEvent = () => {};

  private _elementRects: DOMRect[] = [];
  private _previousOrderedElements: HTMLElement[] = [];
  private _movingElements: HTMLElement[] = [];

  private _defaultOption: DragSortOption = {
    transition: "0.5s cubic-bezier(.49,.92,.02,1.12)",
    handleClass: "handle",
    draggingClass: "dragging",
    shadowClass: "shadow",
    placeholderClass: "placeholder",
    threshold: 0,
  };

  private _option: DragSortOption = this._defaultOption;

  start(container: HTMLElement, option: DragSortOption): void {
    const elements = [...container.children] as HTMLElement[];
    this._option = { ...this._defaultOption, ...option };

    elements.forEach((el: HTMLElement) => {
      const handle = el.querySelector(`.${this._option.handleClass}`);
      const targetEl = !handle ? el : handle.parentElement;
      const draggable = (handle as HTMLElement) ?? el;

      if (!targetEl) return;

      draggable.style.touchAction = "none";
      // To prevent item sticking to pointer
      draggable.ondragstart = () => false;
      draggable.onpointerdown = (e) => this._onDragStart(e, targetEl);
    });
  }

  destroy(): void {
    this._dragEndEvent();
  }

  private _isPointInsideRect(
    rect: DOMRect,
    point: { x: number; y: number }
  ): boolean {
    return (
      point.x > rect.x &&
      point.y > rect.y &&
      point.x < rect.right &&
      point.y < rect.bottom
    );
  }

  private _onDragStart(event: PointerEvent, targetEl: HTMLElement): void {
    if (!this._transitionEnded) return;
    if (!targetEl.parentElement) {
      throw "No container found";
    }

    // To make element like <a> draggable
    event.preventDefault();

    // Use `previousOrderedElements` first, otherwise will get the wrong `startIndex`.
    const elements = this._previousOrderedElements.length
      ? this._previousOrderedElements
      : [...targetEl.parentElement.children] || [];

    this._elementRects.length = 0;
    this._elementRects.push(...elements.map((x) => x.getBoundingClientRect()));

    this._startIndex = this._elementRects.findIndex((rect) =>
      this._isPointInsideRect(rect, { x: event.clientX, y: event.clientY })
    );

    const currentRect = this._elementRects[this._startIndex];
    const startPositionOffset = {
      x: currentRect.x - targetEl.getBoundingClientRect().x,
      y: currentRect.y - targetEl.getBoundingClientRect().y,
    };

    const onTransitionEnd = () => {
      this._reorderElements(targetEl.parentElement);
      targetEl.removeEventListener("transitionend", onTransitionEnd);
      this._transitionEnded = true;
    };

    const dragMoveEvent = (e: PointerEvent) => {
      this._onDragMove(e, targetEl, {
        x: event.clientX - startPositionOffset.x,
        y: event.clientY - startPositionOffset.y,
      });
    };

    this._dragEndEvent = () => {
      this._transitionEnded = false;
      this._onDragEnd(targetEl);
      document.removeEventListener("pointermove", dragMoveEvent);
      document.removeEventListener("pointerup", this._dragEndEvent);
      targetEl.addEventListener("transitionend", onTransitionEnd);
    };

    this._onDragEnd(targetEl);
    this._placeholderEl = this._createPlaceholderEl(targetEl);
    targetEl.parentElement.style.overflowX = "hidden";
    this._shadowEl = this._createShadowEl(targetEl);

    document.addEventListener("pointermove", dragMoveEvent);
    document.addEventListener("pointerup", this._dragEndEvent);
  }

  private _onDragMove(
    e: PointerEvent,
    targetEl: HTMLElement,
    startPosition: { x: number; y: number }
  ): void {
    if (!targetEl) return;

    const posX = e.clientX - startPosition.x;
    const posY = e.clientY - startPosition.y;

    const _endIndex = this._elementRects.findIndex((rect) => {
      const threshold = this._option.threshold ?? 0;
      const newRect: DOMRect = {
        ...rect,
        x: rect.x + threshold,
        y: rect.y + threshold,
        right: rect.right - threshold,
        bottom: rect.bottom - threshold,
      };

      return this._isPointInsideRect(newRect, { x: e.clientX, y: e.clientY });
    });

    targetEl.style.transform = `translate3d(${posX}px, ${posY}px, 1px)`;
    targetEl.style.zIndex = "999";
    targetEl.style.pointerEvents = "none";

    if (this._option.draggingClass) {
      targetEl.classList.add(this._option.draggingClass);
    }

    if (this._shadowEl) {
      this._shadowEl.style.transform = `translate3d(${posX}px, ${posY}px, 1px)`;
    }

    if (this._placeholderEl && this._elementRects[_endIndex]) {
      const rectStart = this._elementRects[this._startIndex];
      const rectEnd = this._elementRects[_endIndex];
      const shadowPosX = rectEnd.x - rectStart.x;
      const shadowPosY = rectEnd.y - rectStart.y;
      this._placeholderEl.style.transform = `translate3d(${shadowPosX}px, ${shadowPosY}px, 1px)`;
    }

    if (_endIndex !== -1 && _endIndex !== this._endIndex) {
      this._endIndex = _endIndex;
      this._visualReordering(targetEl);
    }
  }

  private _onDragEnd(targetEl: HTMLElement): void {
    this._shadowEl?.remove();
    this._placeholderEl?.remove();

    if (!targetEl || this._endIndex === -1) return;
    if (!targetEl.parentElement) {
      throw "No container found";
    }

    const elements =
      ([...targetEl.parentElement.children] as HTMLElement[]) || [];

    this._previousOrderedElements.length = 0;
    this._previousOrderedElements.push(
      ...this._sortList(elements, {
        oldIndex: this._startIndex,
        newIndex: this._endIndex,
      })
    );

    this._animateTargetElement(targetEl);

    targetEl.parentElement.style.removeProperty("overflow");
    this._endIndex = -1;
  }

  private _resetTargetEl(targetEl: HTMLElement): void {
    if (!targetEl) return;

    targetEl.style.removeProperty("position");
    targetEl.style.removeProperty("transform");
    targetEl.style.removeProperty("z-index");
    targetEl.style.removeProperty("transition");
    targetEl.style.removeProperty("pointer-events");
    targetEl.classList.remove("dragging");
  }

  private _createPlaceholderEl(source: HTMLElement): HTMLElement {
    const sourceRect = source.getBoundingClientRect();
    const el = document.createElement("div");

    if (this._option.placeholderClass) {
      el.classList.add(this._option.placeholderClass);
    }

    el.style.position = "fixed";
    el.style.top = `${sourceRect.y}px`;
    el.style.left = `${sourceRect.x}px`;
    el.style.width = `${sourceRect.width}px`;
    el.style.height = `${sourceRect.height}px`;
    el.style.zIndex = "-1";
    el.style.pointerEvents = "none";

    this._placeholderEl?.remove();
    document.body.insertAdjacentElement("beforeend", el);

    return el;
  }

  private _createShadowEl(source: HTMLElement): HTMLElement {
    const sourceRect = source.getBoundingClientRect();
    const el = source.cloneNode(true) as HTMLElement;

    if (this._option.shadowClass) {
      el.classList.add(this._option.shadowClass);
    }

    el.style.position = "fixed";
    el.style.top = `${sourceRect.y}px`;
    el.style.left = `${sourceRect.x}px`;
    el.style.width = `${sourceRect.width}px`;
    el.style.height = `${sourceRect.height}px`;
    el.style.zIndex = "999";
    el.style.pointerEvents = "none";

    this._shadowEl?.remove();
    document.body.insertAdjacentElement("beforeend", el);

    return el;
  }

  private _visualReordering(targetEl: HTMLElement): void {
    if (this._endIndex < 0) return;
    if (!targetEl.parentElement) {
      throw "No container found";
    }

    const elements = this._previousOrderedElements.length
      ? this._previousOrderedElements
      : ([...targetEl.parentElement.children] as HTMLElement[]) || [];
    const moveForward = this._endIndex > this._startIndex;
    const _startIndex = moveForward ? this._startIndex : this._endIndex;
    const _endIndex = moveForward ? this._endIndex : this._startIndex;

    const rects = this._elementRects.slice(_startIndex, _endIndex + 1);
    const indexOffset = moveForward ? 1 : 0;

    // Reset all the transform to let the `movingElements` go back to their previous position
    for (let i = 0; i < this._movingElements.length; i++) {
      this._movingElements[i].style.removeProperty("transform");
    }

    // Collect all `movingElements` within the range of startIndex and endIndex
    this._movingElements.length = 0;
    this._movingElements.push(
      ...elements.slice(_startIndex + indexOffset, _endIndex + indexOffset)
    );

    // Run the loop to move all `movingElements` to their new position
    for (let i = indexOffset; i < rects.length - (moveForward ? 0 : 1); i++) {
      const el = this._movingElements[i - indexOffset];
      if (!el) continue;

      const fromRect = rects[i];
      const toRect = rects[i + (moveForward ? -1 : 1)];
      const posX = toRect.x - fromRect.x;
      const posY = toRect.y - fromRect.y;

      el.style.transition =
        this._option.transition ?? this._defaultOption.transition!;
      el.style.transform = `translate3d(${posX}px, ${posY}px, 0px)`;
    }
  }

  // Animate the current dragging element, after drag end
  private _animateTargetElement(targetEl: HTMLElement): void {
    const fromRect = this._elementRects[this._startIndex];
    const toRect = this._elementRects[this._endIndex];

    if (!fromRect || !toRect) return;

    targetEl.style.transition =
      this._option.transition ?? this._defaultOption.transition!;

    targetEl.style.transform = `translate3d(${toRect.x - fromRect.x}px, ${
      toRect.y - fromRect.y
    }px, 1px)`;
  }

  private _reorderElements(container: HTMLElement | null): void {
    if (!container) return;

    const fragment = document.createDocumentFragment();

    for (const item of this._previousOrderedElements) {
      this._resetTargetEl(item);
      fragment.appendChild(item);
    }

    container.innerHTML = "";
    container.appendChild(fragment);
  }

  private _sortList<T>(
    list: T[],
    e: { oldIndex: number; newIndex: number }
  ): T[] {
    const moveForward = e.newIndex > e.oldIndex;

    list.splice(e.newIndex + (moveForward ? 1 : 0), 0, list[e.oldIndex]);
    list.splice(e.oldIndex + (moveForward ? 0 : 1), 1);

    return list.filter((x) => x !== undefined && x !== null);
  }
}
