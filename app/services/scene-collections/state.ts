import { StatefulService, mutation } from 'services/stateful-service';
import {
  ISceneCollectionsManifestEntry,
  ISceneCollectionSchema,
  ISceneCollectionsServiceApi
} from '.';
import Vue from 'vue';
import fs from 'fs';
import path from 'path';
import electron from 'electron';
import { ISceneCollectionsResponse } from './server-api';
import { FileManagerService } from 'services/file-manager';
import { Inject } from 'util/injector';

interface ISceneCollectionsManifest {
  activeId: string;
  collections: ISceneCollectionsManifestEntry[];
}

/**
 * This is a submodule of the scene collections service that handles
 * state/manifest mutations and persistence.
 *
 * All methods are public, but this class should be considered prviate
 * to the rest of the app.  It is an internal module in the scene collections
 * service.
 */
export class SceneCollectionsStateService extends StatefulService<
  ISceneCollectionsManifest
> {
  @Inject() fileManagerService: FileManagerService;

  static initialState: ISceneCollectionsManifest = {
    activeId: null,
    collections: []
  };

  get collections() {
    return this.state.collections.filter(coll => !coll.deleted);
  }

  get activeCollection() {
    return this.collections.find(coll => coll.id === this.state.activeId);
  }

  /**
   * Handle a new user login
   * @param serverCollections the collections loaded from the server
   */
  async setupNewUser(serverCollections: ISceneCollectionsResponse) {
    if (serverCollections.data.length > 0) {
      this.LOAD_STATE({
        activeId: null,
        collections: []
      });
      await this.ensureDirectory();
      await this.flushManifestFile();
    } else {
      // Do nothing.
      // Local files will be synced up to the server
    }
  }

  /**
   * Loads the manifest file into the state for this service.
   */
  async loadManifestFile() {
    await this.ensureDirectory();

    try {
      const data = await this.readCollectionFile('manifest');

      if (data) {
        const parsed = JSON.parse(data);
        const recovered = await this.checkAndRecoverManifest(parsed);

        if (recovered) this.LOAD_STATE(recovered);
      }
    } catch (e) {
      console.error('Error loading manifest file from disk');
    }

    await this.flushManifestFile();
  }

  /**
   * Takes a parsed manifest and checks it for data integrity
   * errors.  If possible, it will attempt to recover it.
   * Otherwise, it will return undefined.
   */
  async checkAndRecoverManifest(obj: ISceneCollectionsManifest): Promise<ISceneCollectionsManifest> {
    // If there is no collections array, this is unrecoverable
    if (!Array.isArray(obj.collections)) return;

    // Filter out collections we can't recover, and fix ones we can
    const filtered = obj.collections.filter(coll => {
      // If there is no id, this is unrecoverable
      if (coll.id == null) return false;

      // We can recover these
      if (coll.deleted == null) coll.deleted = false;
      if (coll.modified == null) coll.modified = (new Date()).toISOString();

      return true;
    });

    obj.collections = filtered;
    return obj;
  }

  /**
   * The manifest file is simply a copy of the Vuex state of this
   * service, persisted to disk.
   */
  async flushManifestFile() {
    const data = JSON.stringify(this.state, null, 2);
    await this.writeDataToCollectionFile('manifest', data);
  }

  /**
   * Checks if a collection file exists
   * @param id the id of the collection
   */
  async collectionFileExists(id: string) {
    const filePath = this.getCollectionFilePath(id);
    return this.fileManagerService.exists(filePath);
  }

  /**
   * Reads the contents of the file into a string
   * @param id The id of the collection
   */
  readCollectionFile(id: string) {
    const filePath = this.getCollectionFilePath(id);
    return this.fileManagerService.read(filePath);
  }

  /**
   * Writes data to a collection file
   * @param id The id of the file
   * @param data The data to write
   */
  writeDataToCollectionFile(id: string, data: string) {
    const collectionPath = this.getCollectionFilePath(id);
    this.fileManagerService.write(collectionPath, data);
  }

  /**
   * Copies a collection file
   * @param sourceId the scene collection to copy
   * @param destId the scene collection to copy to
   */
  copyCollectionFile(sourceId: string, destId: string) {
    this.fileManagerService.copy(
      this.getCollectionFilePath(sourceId),
      this.getCollectionFilePath(destId)
    );
  }

  /**
   * Creates the scene collections directory if it doesn't exist
   */
  async ensureDirectory() {
    const exists = await new Promise(resolve => {
      fs.exists(this.collectionsDirectory, exists => resolve(exists));
    });

    if (!exists) {
      await new Promise((resolve, reject) => {
        fs.mkdir(this.collectionsDirectory, err => {
          if (err) {
            reject(err);
            return;
          }

          resolve();
        });
      });
    }
  }

  get collectionsDirectory() {
    return path.join(
      electron.remote.app.getPath('userData'),
      'SceneCollections'
    );
  }

  getCollectionFilePath(id: string) {
    return path.join(this.collectionsDirectory, `${id}.json`);
  }

  @mutation()
  SET_ACTIVE_COLLECTION(id: string) {
    this.state.activeId = id;
  }

  @mutation()
  ADD_COLLECTION(id: string, name: string, modified: string) {
    this.state.collections.unshift({
      id,
      name,
      deleted: false,
      modified,
      needsRename: false
    });
  }

  @mutation()
  SET_NEEDS_RENAME(id: string) {
    this.state.collections.find(coll => coll.id === id).needsRename = true;
  }

  @mutation()
  SET_MODIFIED(id: string, modified: string) {
    this.state.collections.find(coll => coll.id === id).modified = modified;
  }

  @mutation()
  SET_SERVER_ID(id: string, serverId: number) {
    this.state.collections.find(coll => coll.id === id).serverId = serverId;
  }

  @mutation()
  RENAME_COLLECTION(id: string, name: string, modified: string) {
    const coll = this.state.collections.find(coll => coll.id === id);
    coll.name = name;
    coll.modified = modified;
    coll.needsRename = false;
  }

  @mutation()
  DELETE_COLLECTION(id: string) {
    this.state.collections.find(coll => coll.id === id).deleted = true;
  }

  @mutation()
  HARD_DELETE_COLLECTION(id: string) {
    this.state.collections = this.state.collections.filter(
      coll => coll.id !== id
    );
  }

  @mutation()
  LOAD_STATE(state: ISceneCollectionsManifest) {
    Object.keys(state).forEach(key => {
      Vue.set(this.state, key, state[key]);
    });
  }
}
